// 页面路径常量（纯常量，可单测）。

/**
 * 首页路径：app.json 的 pages 首项，即冷启动默认落地页。
 * app.onPageNotFound 的兜底跳转也用它——两者脱节会让兜底跳到不存在的页面，
 * 而微信对「兜底页也找不到」只推原生提示页且不再回调，用户就彻底卡住。
 * tests/miniapp/home-route.test.ts 守这条一致性。
 */
export const HOME_PAGE = "/pages/projects/page";
