import {
  bindWithCode,
  ensureBindingTicket,
  getPendingWebLogin,
  refreshBindingTicket,
} from "../../../lib/auth";

/** 绑定/已登录后的落地页：扫码进入的回跳网页登录确认页，否则落到项目 Tab */
function landing(): string {
  return getPendingWebLogin()
    ? "/pages/web-login/page"
    : "/pages/projects/page";
}

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
      // 绑定码校验需要待绑定票据：进页面可能尚未做过微信探测，这里先确保建立。
      // 若该微信已绑定账号则无需绑定码，直接登入。
      const ticket = await ensureBindingTicket();
      if (ticket.status === "ALREADY_BOUND") {
        wx.showToast({ title: "该微信已绑定账号，已直接登录", icon: "none" });
        wx.reLaunch({ url: landing() });
        return;
      }
      await bindWithCode(code);
      wx.reLaunch({ url: landing() });
    } catch (error) {
      const errorCode = (error as { code?: string }).code;
      let message = error instanceof Error ? error.message : "绑定失败，请重试";
      if (errorCode === "BINDING_CODE_INVALID") {
        message = "绑定码无效或已过期，请联系管理员重新生成";
      } else if (
        errorCode === "BINDING_TICKET_INVALID" ||
        errorCode === "BINDING_GONE"
      ) {
        // 票据 10 分钟过期：后台静默重建新票据，用户重试即可
        message = "登录验证已过期，请重新验证账号后重试。";
        void refreshBindingTicket().catch(() => undefined);
      } else if (errorCode === "VALIDATION_ERROR") {
        message = "绑定码格式不正确，请核对后重试";
      } else if (errorCode === "WECHAT_LOGIN_FAILED") {
        message = "微信登录失败，请重试";
      }
      this.setData({ error: message });
    } finally {
      this.setData({ submitting: false });
    }
  },
  onUseAccount() {
    // 邮箱验证登录已并入登录页
    wx.redirectTo({ url: "/pages/auth/login/page" });
  },
});
