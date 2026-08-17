import {
  ensureLoggedIn,
  savePendingWebLogin,
  getPendingWebLogin,
  clearPendingWebLogin,
} from "../../lib/auth";
import { confirmWebQrLogin } from "../../lib/api";

// 微信「扫一扫」/长按识别小程序码直达的确认页（唯一扫码通道）
Page({
  data: {
    pendingPayload: "",
    confirming: false,
    result: "" as "" | "success" | "invalid" | "denied",
  },
  onLoad(query: Record<string, string | undefined>) {
    // 唯一进入方式：小程序码（wxacode.getUnlimited），query.scene = "t=<token>"
    let token = "";
    if (query.scene) {
      const scene = decodeURIComponent(query.scene);
      const match = scene.match(/(?:^|[&;])t=([A-Za-z0-9_-]+)/);
      token = match?.[1] ?? "";
    }
    // 未登录先跳登录页会销毁本页并带走 scene，登录后经 reLaunch 回跳无法再带参数，
    // 此处从暂存中恢复扫码时的票据，继续完成网页登录确认
    if (!token) {
      token = getPendingWebLogin();
    }
    if (!token) {
      this.setData({ result: "invalid" });
      return;
    }
    // 暂存票据：登录跳转会销毁本页，登录成功后据此回跳
    savePendingWebLogin(token);
    this.setData({
      pendingPayload: `t:${token}`,
    });
  },
  onShow() {
    if (!ensureLoggedIn()) return;
    if (this.data.pendingPayload && !this.data.result && !this.data.confirming) {
      // 已登录且票据在手，回跳暂存使命完成，清除以免影响后续普通登录
      clearPendingWebLogin();
      void this.askConfirm();
    }
  },
  async askConfirm() {
    const confirm = await new Promise<boolean>((resolve) => {
      wx.showModal({
        title: "确认登录网页版",
        content: "确认在网页版登录此账号？",
        confirmText: "确认登录",
        success: (result) => resolve(result.confirm),
        fail: () => resolve(false),
      });
    });
    if (!confirm) {
      this.setData({ result: "denied" });
      return;
    }
    await this.doConfirm();
  },
  async doConfirm() {
    if (this.data.confirming) return;
    this.setData({ confirming: true });
    try {
      await confirmWebQrLogin(this.data.pendingPayload);
      this.setData({ result: "success" });
    } catch {
      this.setData({ result: "invalid" });
    } finally {
      this.setData({ confirming: false });
    }
  },
  onRetry() {
    this.setData({ result: "", confirming: false });
    void this.askConfirm();
  },
  onBackHome() {
    wx.switchTab({ url: "/pages/projects/page" });
  },
});
