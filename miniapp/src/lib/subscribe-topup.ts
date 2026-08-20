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
// 与服务端 GRANT_MAX_REMAINING 对齐：已封顶就不必再拉起
export const TOPUP_MAX_REMAINING = 30;

export type TopUpCandidate = {
  /** 用户勾了「总是保持以上选择」，wx.requestSubscribeMessage 才会静默返回 accept */
  persistent: boolean;
  /** 服务端记账的剩余可发条数 */
  remaining: number;
};

/**
 * 挑出本次该续额的模板；返回空数组表示这次点击不拉起授权。
 * - 冷却未过：跳过，避免每次点击都拉一遍还被服务端节流吃掉；
 * - 未长期授权（persistent=false）：必须排除，混进 tmplIds 会弹窗打扰用户；
 * - 额度已封顶：拉了也记不上，省掉。
 */
export function selectTopUpTargets<T extends TopUpCandidate>(
  templates: readonly T[],
  now: number,
  lastTopUpAt: number,
): T[] {
  if (now - lastTopUpAt < TOPUP_COOLDOWN_MS) return [];
  return templates.filter(
    (template) =>
      template.persistent && template.remaining < TOPUP_MAX_REMAINING,
  );
}
