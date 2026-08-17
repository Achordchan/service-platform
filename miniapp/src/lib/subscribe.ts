import {
  getSubscribeGrants,
  getSubscribeMessageConfig,
  reportSubscribeGrant,
  type SubscribeTemplateConfig,
  type WechatTemplateKey,
} from "./api";

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
  /** 用户勾选「总是保持」的长期授权（wx.getSetting 可读） */
  persistent: boolean;
  /** 服务端剩余额度（后端额度接口未就绪时为 0） */
  remaining: number;
  /** 长期授权或仍有额度即视为已订阅 */
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
        subscribed: persistent || remaining > 0,
      };
    },
  );
  const configured = templates.length > 0;
  const missingCount = templates.filter(
    (template) => !template.subscribed,
  ).length;
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
      await reportSubscribeGrant(template.templateKey).catch(() => undefined);
      accepted += 1;
    }
  }
  return accepted;
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
