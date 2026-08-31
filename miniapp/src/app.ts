import {
  bootstrapAuth,
  setIdentitySwitchHandler,
  setSessionEndHandler,
} from "./lib/auth";
import { releaseBadgeSync } from "./lib/badge";
import { getAuthState, setSessionEndedHandler } from "./lib/session";
import { eventSync } from "./lib/events";
import {
  invalidateSubscribeAuthorization,
  resetSubscribeState,
} from "./lib/subscribe";
import { clearDeliveryChannelsCache } from "./lib/delivery";
import { HOME_PAGE } from "./lib/routes";

let leftForeground = false;

App({
  onLaunch() {
    // 账号切换时清空续额状态（在此接线，避免 auth ← subscribe 循环依赖）。
    // 登录/绑定都在 onLaunch 之后发生，注册早于任何 saveToken。
    setIdentitySwitchHandler(resetSubscribeState);
    // 退出登录归还角标的常驻 SSE 租约（同样在此接线，避免 auth ← badge 循环依赖）
    setSessionEndHandler(releaseBadgeSync);
    // 401 被踢下线走的是另一条路（request.ts → session.handleUnauthorized），
    // 不接这条的话租约不还，旧的已鉴权 SSE 会活到超时并在登录页空 token 重连
    setSessionEndedHandler(releaseBadgeSync);
    // 监听注册不依赖登录态：首次登录后的新用户同样需要断网恢复补拉
    wx.onNetworkStatusChange((result) => {
      if (result.isConnected) {
        // 网络恢复：清退避立即重连事件流（不使用轮询）
        eventSync.wake();
      }
    });
    // 启动先完成一次身份校验：校验完成前各页 onShow 会挂起，不启动业务请求，
    // 避免未绑定/失效态下并发业务请求触发 401 风暴与页面跳转打断。
    void bootstrapAuth();
  },
  onPageNotFound(res) {
    // 体验版/旧二维码/历史分享链接可能指向早已不存在的路径（如 pages/index/index），
    // 不接这条用户会停在「页面不存在」，只能自己手动回首页。
    console.warn("[app] page not found, redirect to home:", res.path);
    // onLaunch 的 bootstrapAuth 可能已在跳登录页（未登录冷启）：此时再 reLaunch
    // 首页会盖掉那次跳转，而状态机已置 redirecting，首页 onShow 不会重跳，
    // 用户就卡在未登录的空首页上。让登录跳转赢，它同样离开了不存在的页面。
    if (getAuthState() === "redirecting") return;
    wx.reLaunch({ url: HOME_PAGE });
  },
  onHide() {
    // 进后台后再回前台才作废：冷启的 onShow 不能把还没写过的快照提前作废
    leftForeground = true;
  },
  onShow() {
    if (!leftForeground) return;
    leftForeground = false;
    // 用户可能刚在微信「设置-订阅消息」里关掉了某项，缓存里的 persistent
    // 已不可信；作废后由下次手势 hydrate（Codex P2）
    invalidateSubscribeAuthorization();
    // 通道开关只能在 Web 后台改：小程序进程活着的这段时间里改动传不进来，
    // 提示行就会照着旧通道说话。回前台作废，下次要用时重拉一次。
    clearDeliveryChannelsCache();
  },
});
