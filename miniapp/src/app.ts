import { bootstrapAuth } from "./lib/auth";
import { eventSync } from "./lib/events";

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
});
