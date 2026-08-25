import {
  getSubscribeGrants,
  getSubscribeMessageConfig,
  reportSubscribeGrant,
  type SubscribeTemplateConfig,
  type WechatTemplateKey,
} from "./api";
import {
  selectTopUpTargets,
  shouldHydrateQuota,
  takePendingGrantReports,
} from "./subscribe-topup";

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

/**
 * wx.getSetting 的读取结果。**读失败必须与「读到了但没授权」区分开**：
 * 前者不能拿来断言用户没授权，否则一次瞬时失败就会把所有模板判成未授权
 * ——横幅平白弹出，静默续额也会整段停摆（Codex P2）。
 */
type SubscriptionsSettingResult =
  | { ok: true; itemSettings: Record<string, string> }
  | { ok: false };

// 持久授权状态：itemSettings 以 templateId 为键
function getSubscriptionsSetting(): Promise<SubscriptionsSettingResult> {
  return new Promise((resolve) => {
    wx.getSetting({
      withSubscriptions: true,
      success: (res) => {
        const setting = res.subscriptionsSetting;
        // 成功回调里也可能不带这个字段（如不支持 withSubscriptions 的旧基础库）：
        // 那是「没读到」而不是「没授权」，只有 mainSwitch 才是确凿的全关证据
        if (!setting) {
          resolve({ ok: false });
          return;
        }
        // mainSwitch 关闭是「读到了」的真实状态：全部未持久授权
        if (setting.mainSwitch === false) {
          resolve({ ok: true, itemSettings: {} });
          return;
        }
        resolve({
          ok: true,
          itemSettings: (setting.itemSettings ?? {}) as Record<string, string>,
        });
      },
      fail: () => resolve({ ok: false }),
    });
  });
}

// ── 额度快照 ──
// 点击回调里没时间再发请求，只能读缓存；快照连同读取时刻一起记，过期后不可再当真。

let cachedTemplates: SubscribeTemplateState[] = [];
/** 额度快照的读取时刻（0 表示无有效快照） */
let quotaReadAt = 0;
/** 最近一次拉起订阅授权的时刻，静默续额据此冷却 */
let lastTopUpAt = 0;
/** 微信已 accept、额度 POST 却失败、等待下次手势补报的模板 */
const pendingGrantReports = new Set<WechatTemplateKey>();
/** 最近一次尝试重拉订阅状态的时刻，给「快照始终无效」的客户端兜底限流 */
let lastHydrateAt = 0;
let hydrating = false;

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

function applyCachedPersistent(
  templateKey: WechatTemplateKey,
  persistent: boolean,
) {
  cachedTemplates = cachedTemplates.map((template) =>
    template.templateKey === templateKey
      ? {
          ...template,
          persistent,
          subscribed: isSubscribed(persistent, template.remaining),
        }
      : template,
  );
}

type GrantsResult =
  | { ok: true; grants: Array<{ templateKey: WechatTemplateKey; remaining: number }> }
  | { ok: false };

/**
 * 汇总订阅真实状态：合并「已配置模板」「服务端剩余额度」「微信长期授权」。
 * config 出错降级为不阻断（configured=false / 空），调用方据此隐藏入口；
 * 授权或额度读失败则沿用上一份已知值，并把本次结果标记为无效快照等待重试。
 */
export async function fetchSubscribeState(): Promise<SubscribeState> {
  const [config, grantsResult, settingResult] = await Promise.all([
    getSubscribeMessageConfig().catch(() => ({
      templates: [] as SubscribeTemplateConfig[],
    })),
    getSubscribeGrants()
      .then((result): GrantsResult => ({ ok: true, grants: result.grants }))
      .catch((): GrantsResult => ({ ok: false })),
    getSubscriptionsSetting(),
  ]);
  // getSetting / grants 读失败时沿用上一份已知值（须在覆盖 cachedTemplates 之前取）。
  // 授权必须按 templateId 存：微信的授权表就是以模板 ID 为键的，按 templateKey 存
  // 会在运维轮换模板 ID 时把旧 ID 的「已长期授权」错安到新 ID 上，
  // 于是静默续额会对着一个从未授权的模板弹窗。
  const knownPersistent = new Map(
    cachedTemplates.map((template) => [
      template.templateId,
      template.persistent,
    ]),
  );
  const remainingByKey = new Map(
    grantsResult.ok
      ? grantsResult.grants.map((grant) => [grant.templateKey, grant.remaining])
      : cachedTemplates.map((template) => [
          template.templateKey,
          template.remaining,
        ]),
  );
  const templates: SubscribeTemplateState[] = config.templates.map(
    (template) => {
      const persistent = settingResult.ok
        ? settingResult.itemSettings[template.templateId] === "accept"
        : (knownPersistent.get(template.templateId) ?? false);
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
  // 有效快照 = 拉到了模板 且 授权与额度都确实读到了。
  // 任一不成立都不标记新鲜，让下次 onShow / 点击立刻重试，
  // 而不是把一份残缺快照当真捂满整个信任期（Codex P2：额度读失败
  // 若仍标新鲜，remaining 会被当成 0，已封顶的模板会被空拉一次）。
  quotaReadAt =
    templates.length > 0 && settingResult.ok && grantsResult.ok
      ? Date.now()
      : 0;
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
  let result: Record<string, string>;
  try {
    result = await new Promise<Record<string, string>>((resolve, reject) => {
      wx.requestSubscribeMessage({
        tmplIds,
        success: (res) => resolve(res as unknown as Record<string, string>),
        fail: reject,
      });
    });
  } catch (err) {
    // 主开关被关（20004）是确凿的全关证据：纠正缓存并作废快照，后续手势
    // 不再拿旧 persistent 去静默拉起（Codex P2）。瞬时失败（网络等）不改快照，
    // 由 topUpSubscribeQuota 回滚冷却后让下一个手势立刻重试。
    // 部分基础库把错误码只放在 errMsg 里，两种形态都认。
    const errCode = (err as { errCode?: number } | undefined)?.errCode;
    const errMsg = String(
      (err as { errMsg?: string } | undefined)?.errMsg ?? "",
    );
    if (errCode === 20004 || errMsg.includes("20004")) {
      quotaReadAt = 0;
      cachedTemplates = cachedTemplates.map((template) =>
        template.persistent || template.subscribed
          ? { ...template, persistent: false, subscribed: false }
          : template,
      );
    }
    throw err;
  }
  let accepted = 0;
  for (const template of templates) {
    const status = result[template.templateId];
    if (status === "accept") {
      const reported = await reportGrantOrPend(template.templateKey);
      if (reported) accepted += 1;
    } else if (status) {
      // reject/ban/filter 是微信对这项授权的明确回答：缓存里的 persistent 已不可信，
      // 就地纠正，后续手势不再把它选进静默续额（Codex P2）
      pendingGrantReports.delete(template.templateKey);
      applyCachedPersistent(template.templateKey, false);
    }
  }
  if (accepted > 0) {
    // 横幅/设置页的显式授权同样占掉了服务端 60s 的上报节流窗口：不刷新冷却的话，
    // 紧接着的静默续额会白拉一次微信额度、服务端却记不上（Codex P2）。
    lastTopUpAt = Date.now();
    // quotaReadAt 不在此刷新：本次只重读了参与授权的模板，被跳过的（如已封顶的）
    // 没有重读，冒充整份快照新鲜会让那个 30 永远得不到复核。
  }
  return accepted;
}

async function reportGrantOrPend(templateKey: WechatTemplateKey): Promise<boolean> {
  const granted = await reportSubscribeGrant(templateKey).catch(() => null);
  if (granted) {
    applyCachedRemaining(templateKey, granted.remaining);
    pendingGrantReports.delete(templateKey);
    return true;
  }
  // 微信已经 accept，额度没记上：记下待补报，下次手势只 POST、不再拉起授权。
  // 部分成功时共享冷却仍会刷新（成功的那次占了服务端 60s 节流），失败的模板
  // 走 pending 队列，不被这次冷却挡住（Codex P2）。
  pendingGrantReports.add(templateKey);
  return false;
}

// ── 静默续额 ──

/**
 * 一次性订阅每次 accept 只够发一条：工单回复量最大、额度最先见底，用户会看到
 * 「未开启」却从没取消过授权（用户实测反馈的 bug）。而勾过「总是保持以上选择」
 * 后 wx.requestSubscribeMessage 静默返回 accept、不弹窗，可以在任意用户点击里
 * 悄悄补额度——这就是下面这套的用途。个人开发者申请不到长期订阅模板，只能这样续。
 */

/**
 * 确保额度快照可用且新鲜；fire-and-forget，不阻塞调用方，失败下次重试。
 * 订阅消息会把用户直接冷启到工单详情页（服务端 page 就指向该页），那条路径上
 * 没有顶部横幅、没人写过缓存——不主动 hydrate 的话，详情页里的静默续额永远空转，
 * 而这恰恰是刚被那条通知用掉最后一点额度、最需要续的时候（Codex P1）。
 */
export function ensureSubscribeStateCached(): void {
  if (hydrating) return;
  const now = Date.now();
  if (!shouldHydrateQuota(now, quotaReadAt, lastHydrateAt)) return;
  lastHydrateAt = now;
  hydrating = true;
  void fetchSubscribeState()
    .catch(() => undefined)
    .then(() => {
      hydrating = false;
    });
}

/**
 * 在用户点击回调里静默补订阅额度。
 * 只续 persistent（已勾「总是保持以上选择」）的模板：混入未长期授权的模板会弹窗打扰。
 * 必须在点击回调的同步段调用——wx.requestSubscribeMessage 要求用户手势，await 之后就丢了，
 * 所以本函数全程不 await、也不返回 Promise，调用方直接 `topUpSubscribeQuota()` 即可。
 * 未登录 / 模板未配置时快照为空，天然不会触发。
 */
export function topUpSubscribeQuota(): void {
  // 快照过期就顺手补一次，任何续额手势点都能自愈，不必逐页配 onShow；
  // 本手势会因快照过期而放行不了（见 selectTopUpTargets），刷新完成后的下一次点击恢复
  ensureSubscribeStateCached();
  const pending = takePendingGrantReports(
    cachedTemplates,
    pendingGrantReports,
  );
  if (pending.length > 0) {
    // 只补报，不再拉起授权：微信额度已经给过了，再 request 一次会占冷却。
    // 先从 pending 拿走再 POST，避免两次手势把同一次额度报两次（Codex P2）。
    for (const template of pending) {
      void reportGrantOrPend(template.templateKey);
    }
  }
  const now = Date.now();
  // 刚拿走的 in-flight key 也要排除：否则冷却过期后同一次手势会再拉起授权，
  // 补报 POST 若先落地，新的上报会被 60s 节流吃掉（Codex P2）
  const excludedKeys = new Set<string>([
    ...pendingGrantReports,
    ...pending.map((template) => template.templateKey),
  ]);
  const targets = selectTopUpTargets(
    cachedTemplates,
    now,
    lastTopUpAt,
    quotaReadAt,
    excludedKeys,
  );
  if (targets.length === 0) return;
  lastTopUpAt = now;
  // requestSubscribe 的同步段就会调 wx.requestSubscribeMessage，手势不会丢。
  // 拉起失败时什么都没拿到（弹窗没出现、额度没记上），回滚冷却让下一个手势
  // 立刻能重试；仅当期间没有更新的冷却时才回滚，避免覆盖并发手势的时间戳（Codex P2）
  void requestSubscribe(targets).catch(() => {
    if (lastTopUpAt === now) lastTopUpAt = 0;
  });
}

/**
 * 小程序从后台回到前台时作废授权快照。用户可能刚在微信「设置-订阅消息」里
 * 关掉了某项，缓存里还是 persistent=true；不重读的话下一次手势会弹窗（Codex P2）。
 * 额度本身仍可信，但授权与额度同属一份快照，只能整份作废，等下次手势 hydrate。
 */
export function invalidateSubscribeAuthorization(): void {
  quotaReadAt = 0;
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
