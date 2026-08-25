/**
 * 静默续额的判定逻辑：纯函数，不碰 wx / 网络（同 auth-machine 的拆法，便于单测）。
 *
 * 背景：一次性订阅每次 accept 只够发一条消息，工单回复量最大、额度最先见底，
 * 用户会看到「未开启」却从没取消过授权。个人开发者申请不到长期订阅模板，
 * 只能在用户的每次点击里把额度悄悄续上（勾过「总是保持以上选择」时不弹窗）。
 */

// 服务端 reportSubscribeGrant 对同一模板节流 60s。客户端冷却取 90s 留余量，
// 保证每次静默拉起都真能记上额度，而不是白拉一次被服务端节流丢掉。
export const TOPUP_COOLDOWN_MS = 90 * 1000;
// 与服务端 GRANT_MAX_REMAINING 对齐：额度快照可信时，已封顶就不必再拉起
export const TOPUP_MAX_REMAINING = 30;
// 额度快照的信任期：投递扣减只发生在服务端，快照放久了就会偏高
export const QUOTA_TRUST_MS = 5 * 60 * 1000;

export type TopUpCandidate = {
  templateKey: string;
  /** 用户勾了「总是保持以上选择」，wx.requestSubscribeMessage 才会静默返回 accept */
  persistent: boolean;
  /** 服务端记账的剩余可发条数（快照，见 quotaReadAt） */
  remaining: number;
};

/**
 * 挑出本次该续额的模板；返回空数组表示这次点击不拉起授权。
 * - 冷却未过：跳过，避免每次点击都拉一遍还被服务端节流吃掉；
 * - 快照无效或过信任期：整体跳过（Codex P2）。persistent 与额度同属一份快照，
 *   缓存可能停留任意久，拿过期的 persistent 当「可静默拉起」的依据，用户一旦在
 *   微信设置里关掉订阅就会当场弹窗。topUpSubscribeQuota 已顺手触发 hydrate，
 *   刷新完成后的下一次点击自然恢复；
 * - 未长期授权（persistent=false）：必须排除，混进 tmplIds 会弹窗打扰用户；
 * - 额度已封顶：快照新鲜时才可据此跳过。投递扣减只发生在服务端、不会主动回传，
 *   但信任期一过上面的规则就会强制重新 hydrate，带回服务端真实余额，
 *   所以「过期的 30」只挡得住一个刷新周期，不会把页面永久挡在续额之外。
 */
export function selectTopUpTargets<T extends TopUpCandidate>(
  templates: readonly T[],
  now: number,
  lastTopUpAt: number,
  quotaReadAt: number,
  pendingKeys: ReadonlySet<string> = new Set(),
): T[] {
  if (now - lastTopUpAt < TOPUP_COOLDOWN_MS) return [];
  if (isQuotaSnapshotStale(now, quotaReadAt)) return [];
  return templates.filter(
    (template) =>
      template.persistent &&
      template.remaining < TOPUP_MAX_REMAINING &&
      !pendingKeys.has(template.templateKey),
  );
}

/**
 * 微信已经 accept、额度 POST 却失败的模板：下一次手势只补报，不再拉起授权。
 * 服务端 60s 节流对「没记上的那次」不生效，所以这里不走 90s 冷却。
 */
export function selectPendingGrantReports<T extends TopUpCandidate>(
  templates: readonly T[],
  pendingKeys: ReadonlySet<string>,
): T[] {
  if (pendingKeys.size === 0) return [];
  return templates.filter((template) => pendingKeys.has(template.templateKey));
}

/**
 * 发出补报 POST 前把 key 从 pending 里拿走，避免两次手势把同一次额度报两次。
 * 服务端节流是先读后写，并发两次都能过 60s 检查，remaining 会多加 1。
 * 调用方在 POST 失败时把这些 key 放回去。
 */
export function takePendingGrantReports<T extends TopUpCandidate>(
  templates: readonly T[],
  pendingKeys: Set<string>,
  inFlightKeys: Set<string> = new Set(),
): T[] {
  const selected = selectPendingGrantReports(templates, pendingKeys);
  for (const template of selected) {
    pendingKeys.delete(template.templateKey);
    inFlightKeys.add(template.templateKey);
  }
  return selected;
}

// 快照无效时的重拉间隔。旧基础库可能永远读不到 subscriptionsSetting，
// 快照会一直判为无效——没有这个下限，每次点击都要多打两个接口。
export const HYDRATE_RETRY_MS = 30 * 1000;

/** 额度快照是否已过信任期，需要重新拉一次真实额度 */
export function isQuotaSnapshotStale(now: number, quotaReadAt: number): boolean {
  return now - quotaReadAt >= QUOTA_TRUST_MS;
}

/** 是否该重拉订阅状态：快照过期，且距上次尝试已过重试间隔 */
export function shouldHydrateQuota(
  now: number,
  quotaReadAt: number,
  lastHydrateAt: number,
): boolean {
  if (!isQuotaSnapshotStale(now, quotaReadAt)) return false;
  return now - lastHydrateAt >= HYDRATE_RETRY_MS;
}
