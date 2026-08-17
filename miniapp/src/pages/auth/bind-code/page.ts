import { bindWithCode, getPendingWebLogin } from "../../../lib/auth";

Page({
  data: {
    code: "",
    submitting: false,
    error: "",
  },
  onCodeInput(event: WechatMiniprogram.Input) {
    this.setData({ code: event.detail.value });
  },
  async onSubmit() {
    if (this.data.submitting) return;
    const code = this.data.code.trim();
    if (code.length < 8) {
      this.setData({ error: "请输入完整的绑定码" });
      return;
    }
    this.setData({ submitting: true, error: "" });
    try {
      await bindWithCode(code);
      // 扫码进入登录的用户绑定成功后回跳网页登录确认页，否则落到项目 Tab
      wx.reLaunch({
        url: getPendingWebLogin()
          ? "/pages/web-login/page"
          : "/pages/projects/page",
      });
    } catch (error) {
      this.setData({
        error: error instanceof Error ? error.message : "绑定失败，请重试",
      });
    } finally {
      this.setData({ submitting: false });
    }
  },
  onUseAccount() {
    // 邮箱验证登录已并入登录页
    wx.redirectTo({ url: "/pages/auth/login/page" });
  },
});
