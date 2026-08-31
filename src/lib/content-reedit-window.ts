/**
 * 撤回内容的「重新编辑」时限。
 *
 * 对齐微信 / 企业微信的做法：撤回后 5 分钟内才给「重新编辑」，超时该入口直接
 * 消失（微信撤回本身限 2 分钟，重新编辑限 5 分钟；企业微信同为 5 分钟）。
 * 常驻的重新编辑按钮有两个问题：撤回原文会长期回送到客户端，且半年后仍能
 * 把当初判违规的原话一键复活。窗口从撤回时刻（ContentRiskState.revokedAt）
 * 起算，而不是发消息时刻 —— 风控是异步复查，作者要在得知被撤回之后才有机会改。
 */
export const CONTENT_REEDIT_WINDOW_MS = 5 * 60 * 1000;

/** 撤回时刻 → 重新编辑截止时刻；没有撤回时刻（未撤回/历史脏数据）返回 null。 */
export function contentReeditExpiresAt(
  revokedAt: Date | string | null | undefined,
): Date | null {
  if (!revokedAt) return null;
  const revoked = revokedAt instanceof Date ? revokedAt : new Date(revokedAt);
  const revokedMs = revoked.getTime();
  if (Number.isNaN(revokedMs)) return null;
  return new Date(revokedMs + CONTENT_REEDIT_WINDOW_MS);
}

/** 当前是否仍在重新编辑窗口内。 */
export function isWithinContentReeditWindow(
  revokedAt: Date | string | null | undefined,
  nowMs: number = Date.now(),
) {
  const expiresAt = contentReeditExpiresAt(revokedAt);
  return expiresAt !== null && expiresAt.getTime() > nowMs;
}
