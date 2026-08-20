import {
  getSubscribeGrants,
  getSubscribeMessageConfig,
  reportSubscribeGrant,
  type SubscribeTemplateConfig,
  type WechatTemplateKey,
} from "./api";
import { selectTopUpTargets } from "./subscribe-topup";

// 订阅模板的中文名，用于设置页与引导文案（config 接口只回 key/id）
const TEMPLATE_LABELS: Record<WechatTemplateKey, string> = {
  REQUEST_REPLY: "工单新回复",
  REQUEST_STATUS: "工单状态变化",
  PROJECT_UPDATE: "项目动态",
};

export type SubscribeTemplateState = {
  templateKey: WechatTemplateKey;
  templateId: string;
  label: string;
  /** 用户勾选「总是保持」的长期授权（wx.getSetting 实时可读，关闭即变 false） */
  persistent: boolean;
  /** 服务端剩余可发额度（一次性订阅每次发送消耗，发送遇 43101 归零） */
  remaining: number;
  /**
   * 是否确认已开启：长期授权（persistent）且仍有可发额度（remaining>0），二者缺一不可。
   * - 仅信 remaining：用户在微信「设置-订阅消息」里手动关闭后，后端并不知情、
   *   remaining 停在旧值，会误报已开启（用户反馈的 bug）；persistent 由 wx.getSetting
   *   实时读取，关闭后立即 false，纠正这一点。
   * - 仅信 persistent：一次性额度用完（remaining=0）后服务端不再发、也不触发 43101
   *   归零，会永远显示已开启却收不到；叠加 remaining>0 可在耗尽时回落并提示重新开启，自愈。
   */
  subscribed: boolean;
};

export type SubscribeState = {
  /** 是否已配置正式模板（未配置则无法订阅） */
  configured: boolean;
  templates: SubscribeTemplateState[];
  allSubscribed: boolean;
  /** 未订阅的模板数量 */
  missingCount: number;
};

/**
 * 是否确认已开启：长期授权且仍有可发额度（判定理由见 SubscribeTemplateState.subscribed）。
 * fetchSubscribeState 与静默续额回写共用这一处，避免两边的判定漂移。
 */
function isSubscribed(persistent: boolean, remaining: number): boolean {
  return persistent && remaining > 0;
}

// wx.getSetting 的持久授权状态：itemSettings 以 templateId 为键
function getSubscriptionsSetting(): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    wx.getSetting({
      withSubscriptions: true,
      success: (res) => {
        const setting = res.subscriptionsSetting;
        // mainSwitch 关闭时视为全部未持久授权
        if (!setting || setting.mainSwitch === false) {
          resolve({});
          return;
        }
        resolve((setting.itemSettings ?? {}) as Record<string, string>);
      },
      fail: () => resolve({}),
    });
  });
}

/**
 * 汇总订阅真实状态：合并「已配置模板」「服务端剩余额度」「微信长期授权」。
 * 额度接口或 config 出错都降级为不阻断（configured=false / 空），调用方据此隐藏入口。
 */
export async function fetchSubscribeState(): Promise<SubscribeState> {
  const [config, grantsResult, itemSettings] = await Promise.all([
    getSubscribeMessageConfig().catch(() => ({
      templates: [] as SubscribeTemplateConfig[],
    })),
    getSubscribeGrants().catch(() => ({ grants: [] })),
    getSubscriptionsSetting(),
  ]);
  const remainingByKey = new Map(
    grantsResult.grants.map((grant) => [grant.templateKey, grant.remaining]),
  );
  const templates: SubscribeTemplateState[] = config.templates.map(
    (template) => {
      const persistent = itemSettings[template.templateId] === "accept";
      const remaining = remainingByKey.get(template.templateKey) ?? 0;
      return {
        templateKey: template.templateKey,
        templateId: template.templateId,
        label: TEMPLATE_LABELS[template.templateKey] ?? template.templateKey,
        persistent,
        remaining,
        // 长期授权(可确认关闭) 且 仍有可发额度(耗尽自愈)，二者兼备才算确认已开启
        subscribed: isSubscribed(persistent, remaining),
      };
    },
  );
  const configured = templates.length > 0;
  const missingCount = templates.filter(
    (template) => !template.subscribed,
  ).length;
  // 供 topUpSubscribeQuota 在点击回调的同步段取用（那里来不及再发请求）
  cachedTemplates = templates;
  return {
    configured,
    templates,
    allSubscribed: configured && missingCount === 0,
    missingCount,
  };
}

/**
 * 拉起微信订阅授权并回传结果。必须在用户点击回调内调用（微信限制）。
 * 返回本次被接受（accept）的模板数量。
 */
export async function requestSubscribe(
  templates: Array<Pick<SubscribeTemplateState, "templateKey" | "templateId">>,
): Promise<number> {
  const tmplIds = templates
    .map((template) => template.templateId)
    .filter(Boolean);
  if (tmplIds.length === 0) return 0;
  const result = await new Promise<Record<string, string>>(
    (resolve, reject) => {
      wx.requestSubscribeMessage({
        tmplIds,
        success: (res) => resolve(res as unknown as Record<string, string>),
        fail: reject,
      });
    },
  );
  let accepted = 0;
  for (const template of templates) {
    if (result[template.templateId] === "accept") {
      const granted = await reportSubscribeGrant(template.templateKey).catch(
        () => null,
      );
      if (granted) applyCachedRemaining(template.templateKey, granted.remaining);
      accepted += 1;
    }
  }
  return accepted;
}

// ── 静默续额 ──

/**
 * 一次性订阅每次 accept 只够发一条：工单回复量最大、额度最先见底，用户会看到
 * 「未开启」却从没取消过授权（用户实测反馈的 bug）。而勾过「总是保持以上选择」
 * 后 wx.requestSubscribeMessage 静默返回 accept、不弹窗，可以在任意用户点击里
 * 悄悄补额度——这就是下面这套的用途。个人开发者申请不到长期订阅模板，只能这样续。
 */

/** 最近一次 fetchSubscribeState 的结果；点击回调里没时间再发请求，只能读缓存 */
let cachedTemplates: SubscribeTemplateState[] = [];
let lastTopUpAt = 0;

function applyCachedRemaining(
  templateKey: WechatTemplateKey,
  remaining: number,
) {
  cachedTemplates = cachedTemplates.map((template) =>
    template.templateKey === templateKey
      ? {
          ...template,
          remaining,
          subscribed: isSubscribed(template.persistent, remaining),
        }
      : template,
  );
}

/**
 * 在用户点击回调里静默补订阅额度。
 * 只续 persistent（已勾「总是保持以上选择」）的模板：混入未长期授权的模板会弹窗打扰。
 * 必须在点击回调的同步段调用——wx.requestSubscribeMessage 要求用户手势，await 之后就丢了，
 * 所以本函数全程不 await、也不返回 Promise，调用方直接 `topUpSubscribeQuota()` 即可。
 * 未登录 / 模板未配置时 cachedTemplates 为空，天然不会触发。
 */
export function topUpSubscribeQuota(): void {
  const now = Date.now();
  const targets = selectTopUpTargets(cachedTemplates, now, lastTopUpAt);
  if (targets.length === 0) return;
  lastTopUpAt = now;
  // requestSubscribe 的同步段就会调 wx.requestSubscribeMessage，手势不会丢
  void requestSubscribe(targets).catch(() => undefined);
}

// ── 顶部引导横幅的忽略状态与首屏引导标记 ──

const BANNER_DISMISS_KEY = "miniapp_subscribe_banner_dismissed_at";
// 忽略后 7 天内不再打扰，之后若仍未订阅会再次出现
const BANNER_DISMISS_TTL = 7 * 24 * 60 * 60 * 1000;
const AUTO_PROMPT_KEY = "miniapp_subscribe_auto_prompted";

export function isBannerDismissed(): boolean {
  const ts = wx.getStorageSync(BANNER_DISMISS_KEY);
  if (typeof ts !== "number") return false;
  return Date.now() - ts < BANNER_DISMISS_TTL;
}

export function dismissBanner() {
  wx.setStorageSync(BANNER_DISMISS_KEY, Date.now());
}

export function clearBannerDismiss() {
  wx.removeStorageSync(BANNER_DISMISS_KEY);
}

/** 是否已做过首屏主动引导（每设备仅一次，避免反复打扰） */
export function hasAutoPrompted(): boolean {
  return Boolean(wx.getStorageSync(AUTO_PROMPT_KEY));
}

export function markAutoPrompted() {
  wx.setStorageSync(AUTO_PROMPT_KEY, Date.now());
}
