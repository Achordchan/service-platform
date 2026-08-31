// 页面不存在兜底：纯逻辑、不引用 wx（副作用经依赖注入），便于单元测试。
// 与 auth-machine 同样的分层理由 —— 这段判断决定用户能否离开「页面不存在」，
// 守卫写反或跳转丢失都是静默故障，必须能在测试里直接跑到。
import type { AuthState } from "./auth-machine";
import { HOME_PAGE } from "./routes";

export type MissingPageDeps = {
  getAuthState: () => AuthState;
  reLaunch: (url: string) => void;
  warn: (message: string, path: string) => void;
};

/**
 * 体验版/旧二维码/历史分享链接可能指向早已不存在的路径（如 pages/index/index），
 * 不接这条用户会停在「页面不存在」，只能自己手动回首页。
 */
export function handleMissingPage(deps: MissingPageDeps, path: string): void {
  // 应用内跳转拼错路径也会走到这里，留一行日志以免被兜底静默掩盖
  deps.warn("[app] page not found, redirect to home:", path);
  // 未登录冷启时 onLaunch 的 bootstrapAuth 已在跳登录页并把状态机置为 redirecting：
  // 此时再 reLaunch 首页会盖掉那次跳转，而首页 onShow 的 requireAuth 在 redirecting
  // 下不会重跳，用户就卡在未登录的空首页上。让登录跳转赢，它同样离开了不存在的页面。
  if (deps.getAuthState() === "redirecting") return;
  deps.reLaunch(HOME_PAGE);
}
