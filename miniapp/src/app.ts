import { bootstrapAuth } from "./lib/auth";
import { eventSync } from "./lib/events";
import { invalidateSubscribeAuthorization } from "./lib/subscribe";

let leftForeground = false;

App({
  onLaunch() {
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
  },
});
