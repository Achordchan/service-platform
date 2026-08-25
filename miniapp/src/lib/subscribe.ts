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
const LAST_TOPUP_KEY = "miniapp_subscribe_last_topup_at";
const PENDING_GRANTS_KEY = "miniapp_subscribe_pending_grants";
const KNOWN_TEMPLATE_KEYS = new Set<WechatTemplateKey>([
  "REQUEST_REPLY",
  "REQUEST_STATUS",
  "PROJECT_UPDATE",
]);
/** 最近一次拉起订阅授权的时刻，静默续额据此冷却（跨进程要从本地存储恢复） */
let lastTopUpAt = 0;
let lastTopUpHydrated = false;
/** 微信已 accept、额度 POST 却失败、等待下次手势补报的模板 */
const pendingGrantReports = new Set<WechatTemplateKey>();
let pendingGrantReportsHydrated = false;
/** 补报 POST 发出后尚未落地：跨手势也要从静默拉起里排除 */
const inFlightGrantReports = new Set<WechatTemplateKey>();
/** 最近一次尝试重拉订阅状态的时刻，给「快照始终无效」的客户端兜底限流 */
let lastHydrateAt = 0;
/**
 * 正在进行 hydrate 的快照代际（-1 表示没有在途）。用代际而非布尔：换账号/作废会
 * bump hydrateGeneration，此时陈旧的在途 fetch 结果反正会被写守卫丢弃，不能拿它挡住
 * 本代际的重拉；陈旧完成也不得清掉新 fetch 的守卫（Codex P2）。
 */
let hydratingGeneration = -1;
/**
 * 身份代际：每次换账号（resetSubscribeState）自增。补报是 fire-and-forget，
 * POST 在途时若换了账号，回调必须凭这个代际识别出「这是旧账号的结果」并整体作废，
 * 否则会把旧账号的额度写进新账号状态（Codex P2）。
 */
let stateGeneration = 0;
/**
 * 快照代际：换账号（reset）与从微信设置返回（invalidate）都自增。fetchSubscribeState
 * 是异步的，若它跨越了一次作废才回来，无条件回写会把刚清掉的快照又填回并标新鲜——
 * 新账号用上旧账号的额度、或过期的 persistent 又被信任 5 分钟而弹窗（Codex P2）。
 * 与 stateGeneration 分开：本代际在 onShow 也自增，不能牵连补报回写的作废判定。
 */
let hydrateGeneration = 0;

function getLastTopUpAt(): number {
  if (!lastTopUpHydrated) {
    lastTopUpHydrated = true;
    const ts = wx.getStorageSync(LAST_TOPUP_KEY);
    if (typeof ts === "number" && ts > 0) lastTopUpAt = ts;
  }
  return lastTopUpAt;
}

function setLastTopUpAt(ts: number) {
  lastTopUpHydrated = true;
  lastTopUpAt = ts;
  if (ts > 0) wx.setStorageSync(LAST_TOPUP_KEY, ts);
  else wx.removeStorageSync(LAST_TOPUP_KEY);
}

function persistPendingGrantReports() {
  hydratePendingGrantReports();
  const keys = [...pendingGrantReports];
  if (keys.length > 0) wx.setStorageSync(PENDING_GRANTS_KEY, keys);
  else wx.removeStorageSync(PENDING_GRANTS_KEY);
}

function hydratePendingGrantReports() {
  if (pendingGrantReportsHydrated) return;
  pendingGrantReportsHydrated = true;
  const stored = wx.getStorageSync(PENDING_GRANTS_KEY);
  if (!Array.isArray(stored)) return;
  for (const key of stored) {
    if (typeof key === "string" && KNOWN_TEMPLATE_KEYS.has(key as WechatTemplateKey)) {
      pendingGrantReports.add(key as WechatTemplateKey);
    }
  }
}

function markPendingGrant(templateKey: WechatTemplateKey) {
  hydratePendingGrantReports();
  pendingGrantReports.add(templateKey);
  persistPendingGrantReports();
}

function clearPendingGrant(templateKey: WechatTemplateKey) {
  hydratePendingGrantReports();
  pendingGrantReports.delete(templateKey);
  persistPendingGrantReports();
}

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
  // 记下发起时的快照代际：await 期间若发生换账号或 onShow 作废，回来就丢弃回写，
  // 只把结果返回给调用方渲染，不污染供静默续额取用的模块缓存（Codex P2）
  const gen = hydrateGeneration;
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
  // 发起后若被换账号/onShow 作废（代际变了），这份结果已陈旧：只返回、不回写缓存，
  // 否则会把刚清掉的快照又填回并标新鲜（Codex P2）
  if (gen === hydrateGeneration) {
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
  }
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
  // 记下发起时的身份代际：拉授权与逐个补报都是 await，其间若换账号，这些 accept 属于
  // 旧账号，绝不能用新账号的 token 报上去。全程复检，切换即整段作废（Codex P2）
  const gen = stateGeneration;
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
    // 20004 是旧账号主开关关闭的证据：换账号后回来就别再往新账号缓存上纠正（Codex P2）
    if (
      gen === stateGeneration &&
      (errCode === 20004 || errMsg.includes("20004"))
    ) {
      quotaReadAt = 0;
      cachedTemplates = cachedTemplates.map((template) =>
        template.persistent || template.subscribed
          ? { ...template, persistent: false, subscribed: false }
          : template,
      );
    }
    throw err;
  }
  // 拉授权的 await 期间换了账号：这些 accept 属于旧账号，整段作废（Codex P2）
  if (gen !== stateGeneration) return 0;
  // 显式订阅前先 hydrate：冷启后 pending 只在 storage 里，不先灌进内存的话下面
  // wasPending 的 .has() 会漏读，旧额度会被这次成功清掉且不再挂回（Codex P2）
  hydratePendingGrantReports();
  let accepted = 0;
  for (const template of templates) {
    // 逐个补报是串行 await，其间也可能换账号：每轮开头复检，切换即停止处理（Codex P2）
    if (gen !== stateGeneration) break;
    const status = result[template.templateId];
    if (status === "accept") {
      // 这个模板本就有一份没记上的旧额度（pending）时，横幅/设置页的显式订阅又拿到了
      // 新的一份。reportGrantOrPend 成功会顺手 clearPendingGrant，等于拿「新额度记上了」
      // 冒充把旧额度也结清——但两次 accept 撞在服务端 60s 节流里只记得上一份，旧的那份
      // 就永久丢了（Codex P2）。记住它本来 pending，成功后重新挂回，让旧额度留到下一次
      // 手势（过了节流）再补报，而不是被这次成功吞掉。
      const wasPending = pendingGrantReports.has(template.templateKey);
      const reported = await reportGrantOrPend(template.templateKey);
      if (reported) {
        accepted += 1;
        if (wasPending) markPendingGrant(template.templateKey);
      }
    } else if (status) {
      // reject/ban/filter 是微信对这项授权的明确回答：缓存里的 persistent 已不可信，
      // 就地纠正，后续手势不再把它选进静默续额（Codex P2）。
      // 但不清 pending：pending 记的是这个模板此前已 accept、只是 POST 没记上的旧额度，
      // 本次 reject 既没消费也没上报它，清掉就把那份旧额度永久丢了——旧额度仍走 POST 补报，
      // 补报按 templateKey 走，与当前 persistent 无关（Codex P2）
      applyCachedPersistent(template.templateKey, false);
    }
  }
  if (accepted > 0 && gen === stateGeneration) {
    // 横幅/设置页的显式授权同样占掉了服务端 60s 的上报节流窗口：不刷新冷却的话，
    // 紧接着的静默续额会白拉一次微信额度、服务端却记不上（Codex P2）。
    // 换账号后不写：这份冷却属于旧账号，落到新账号会平白压掉一次续额。
    setLastTopUpAt(Date.now());
    // quotaReadAt 不在此刷新：本次只重读了参与授权的模板，被跳过的（如已封顶的）
    // 没有重读，冒充整份快照新鲜会让那个 30 永远得不到复核。
  }
  return accepted;
}

async function reportGrantOrPend(templateKey: WechatTemplateKey): Promise<boolean> {
  const gen = stateGeneration;
  inFlightGrantReports.add(templateKey);
  try {
    const granted = await reportSubscribeGrant(templateKey).catch(() => null);
    // POST 在途时换了账号：这次结果属于旧账号，任何回写都会污染新账号，整体作废（Codex P2）。
    // in-flight 也不在此清：resetSubscribeState 已整体 clear，误删会动到新账号的同名 key。
    if (gen !== stateGeneration) return false;
    if (granted) {
      applyCachedRemaining(templateKey, granted.remaining);
      clearPendingGrant(templateKey);
      // 补报成功也占了服务端 60s 节流：不刷新冷却的话，冷却已过的下一次手势
      // 会再 request，服务端把新额度吞掉（Codex P2）
      setLastTopUpAt(Date.now());
      return true;
    }
    // 微信已经 accept，额度没记上：记下待补报，下次手势只 POST、不再拉起授权。
    // 部分成功时共享冷却仍会刷新（成功的那次占了服务端 60s 节流），失败的模板
    // 走 pending 队列，不被这次冷却挡住（Codex P2）。
    markPendingGrant(templateKey);
    return false;
  } finally {
    // 仅同账号才清 in-flight：换账号后 reset 已清空，别误删新账号刚加的同名 key
    if (gen === stateGeneration) inFlightGrantReports.delete(templateKey);
  }
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
  // 只在「当前代际已有在途 hydrate」时才跳过：陈旧代际的在途 fetch 结果反正会被丢弃，
  // 换账号/作废后不能拿它挡住本代际的重拉，否则从设置返回后要等旧 fetch 完成、再等下
  // 一次手势才能续额，这段窗口 quotaReadAt=0 续不了额（Codex P2）
  if (hydratingGeneration === hydrateGeneration) return;
  const now = Date.now();
  if (!shouldHydrateQuota(now, quotaReadAt, lastHydrateAt)) return;
  lastHydrateAt = now;
  const gen = hydrateGeneration;
  hydratingGeneration = gen;
  void fetchSubscribeState()
    .catch(() => undefined)
    .then(() => {
      // 仅当没有更新的代际接管在途标记时才清空，避免陈旧完成清掉新 fetch 的守卫
      if (hydratingGeneration === gen) hydratingGeneration = -1;
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
  hydratePendingGrantReports();
  const pending = takePendingGrantReports(
    cachedTemplates,
    pendingGrantReports,
    inFlightGrantReports,
  );
  if (pending.length > 0) {
    // 只补报，不再拉起授权：微信额度已经给过了，再 request 一次会占冷却。
    // 先从 pending 拿走再 POST，避免两次手势把同一次额度报两次（Codex P2）。
    for (const template of pending) {
      void reportGrantOrPend(template.templateKey);
    }
  }
  const now = Date.now();
  // pending + 正在飞的补报都排除：第二次手势不能在 POST 落地前再 request
  // 同一个模板，否则会跟补报抢 60s 节流（Codex P2）
  const excludedKeys = new Set<string>([
    ...pendingGrantReports,
    ...inFlightGrantReports,
  ]);
  const targets = selectTopUpTargets(
    cachedTemplates,
    now,
    getLastTopUpAt(),
    quotaReadAt,
    excludedKeys,
  );
  if (targets.length === 0) return;
  setLastTopUpAt(now);
  // requestSubscribe 的同步段就会调 wx.requestSubscribeMessage，手势不会丢。
  // 拉起失败时什么都没拿到（弹窗没出现、额度没记上），回滚冷却让下一个手势
  // 立刻能重试；仅当期间没有更新的冷却时才回滚，避免覆盖并发手势的时间戳（Codex P2）
  void requestSubscribe(targets).catch(() => {
    if (getLastTopUpAt() === now) setLastTopUpAt(0);
  });
}

/**
 * 小程序从后台回到前台时作废授权快照。用户可能刚在微信「设置-订阅消息」里
 * 关掉了某项，缓存里还是 persistent=true；不重读的话下一次手势会弹窗（Codex P2）。
 * 额度本身仍可信，但授权与额度同属一份快照，只能整份作废，等下次手势 hydrate。
 */
export function invalidateSubscribeAuthorization(): void {
  quotaReadAt = 0;
  // 自增快照代际：作废前发起、之后才回来的 fetch 不得把这份旧快照重新标新鲜（Codex P2）
  hydrateGeneration += 1;
  // 一并清掉重拉限流：不然刚 hydrate 过（lastHydrateAt 很近）就去改微信设置、返回后
  // 最长 30s 内 shouldHydrateQuota 仍拒绝重拉，而 quotaReadAt=0 又让续额整体跳过，
  // 这段窗口既拉不到新状态也续不了额。此处由 onShow 触发、低频，不会重蹈「每次点击都打接口」（Codex P2）
  lastHydrateAt = 0;
}

/**
 * 账号切换（登录/绑定/换号后重登）时清空续额状态。冷却与 pending 都存在全局
 * storage、不按账号隔离，模块级内存状态又会跨 reLaunch 残留（reLaunch 不重启 JS）：
 * 换账号后旧账号的 pending 会用新账号的 token 补报，把额度记到别人头上、并删掉原
 * 用户的补报；继承来的冷却也会压掉新账号的正常续额（Codex P2）。持久化与内存一起清。
 * 由 auth.saveToken 注入触发（app.ts 接线），避免 auth ← subscribe 的循环依赖。
 * 同一账号的重登也会走到这里，最多丢一份尚未补报的旧额度（remaining 少记 1，偏安全
 * 方向，不会把未授权的消息发出去），与 eventSync.reset 在 saveToken 里的取舍一致。
 */
export function resetSubscribeState(): void {
  // 先自增代际：在途的旧账号补报回调据此整体作废，不再回写新账号状态（Codex P2）
  stateGeneration += 1;
  // 快照代际同样自增：换账号前发起、之后才回来的 fetch 不得填回旧账号快照（Codex P2）
  hydrateGeneration += 1;
  cachedTemplates = [];
  quotaReadAt = 0;
  lastHydrateAt = 0;
  lastTopUpAt = 0;
  lastTopUpHydrated = false;
  pendingGrantReports.clear();
  pendingGrantReportsHydrated = false;
  inFlightGrantReports.clear();
  wx.removeStorageSync(LAST_TOPUP_KEY);
  wx.removeStorageSync(PENDING_GRANTS_KEY);
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
