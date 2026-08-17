import { ensureLoggedIn } from "./lib/auth";
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
    ensureLoggedIn();
  },
});
