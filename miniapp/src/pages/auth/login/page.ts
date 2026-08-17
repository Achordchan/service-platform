import {
  loginWithWechat,
  loginWithEmail,
  sendLoginOtp,
} from "../../../lib/auth";

type EmailMode = "password" | "otp";

Page({
  data: {
    view: "wechat" as "wechat" | "email",
    emailMode: "password" as EmailMode,
    email: "",
    password: "",
    otp: "",
    otpSent: false,
    sendingOtp: false,
    countdown: 0,
    submitting: false,
    error: "",
    // 未绑定提示（微信一键后引导邮箱验证）
    needsBinding: false,
  },
  countdownTimer: null as ReturnType<typeof setInterval> | null,

  onUnload() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  },

  // ── 视图切换 ──
  onShowEmailLogin() {
    this.setData({ view: "email", error: "" });
  },
  onBackToWechat() {
    this.setData({ view: "wechat", error: "" });
  },

  // ── 微信一键 ──
  async onWechatLogin() {
    if (this.data.submitting) return;
    this.setData({ submitting: true, error: "" });
    try {
      const result = await loginWithWechat();
      if (result.status === "SESSION_ISSUED") {
        wx.reLaunch({ url: "/pages/projects/page" });
        return;
      }
      // 未绑定：引导用邮箱验证（验证成功即自动绑定，下次可一键登录）
      this.setData({ view: "email", needsBinding: true, error: "" });
    } catch (error) {
      this.setData({
        error: error instanceof Error ? error.message : "登录失败，请重试",
      });
    } finally {
      this.setData({ submitting: false });
    }
  },

  // ── 邮箱登录 ──
  onEmailInput(event: WechatMiniprogram.Input) {
    this.setData({ email: event.detail.value });
  },
  onPasswordInput(event: WechatMiniprogram.Input) {
    this.setData({ password: event.detail.value });
  },
  onOtpInput(event: WechatMiniprogram.Input) {
    this.setData({ otp: event.detail.value });
  },
  onSwitchEmailMode() {
    this.setData({
      emailMode: this.data.emailMode === "password" ? "otp" : "password",
      error: "",
    });
  },
  async onSendOtp() {
    if (this.data.sendingOtp || this.data.countdown > 0) return;
    const email = this.data.email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.setData({ error: "请先输入登录邮箱" });
      return;
    }
    this.setData({ sendingOtp: true, error: "" });
    try {
      await sendLoginOtp(email);
      this.setData({ otpSent: true });
      wx.showToast({ title: "验证码已发送", icon: "success" });
      this.startCountdown();
    } catch (error) {
      this.setData({
        error: error instanceof Error ? error.message : "验证码发送失败",
      });
    } finally {
      this.setData({ sendingOtp: false });
    }
  },
  startCountdown() {
    this.setData({ countdown: 60 });
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.countdownTimer = setInterval(() => {
      const next = this.data.countdown - 1;
      this.setData({ countdown: Math.max(0, next) });
      if (next <= 0 && this.countdownTimer) {
        clearInterval(this.countdownTimer);
        this.countdownTimer = null;
      }
    }, 1000);
  },
  async onEmailLogin() {
    if (this.data.submitting) return;
    const email = this.data.email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.setData({ error: "请输入登录邮箱" });
      return;
    }
    if (this.data.emailMode === "password" && !this.data.password) {
      this.setData({ error: "请输入密码" });
      return;
    }
    if (this.data.emailMode === "otp" && !this.data.otp) {
      this.setData({ error: "请输入邮箱验证码" });
      return;
    }
    this.setData({ submitting: true, error: "" });
    try {
      await loginWithEmail({
        email,
        password:
          this.data.emailMode === "password" ? this.data.password : undefined,
        otp: this.data.emailMode === "otp" ? this.data.otp : undefined,
      });
      wx.reLaunch({ url: "/pages/projects/page" });
    } catch (error) {
      const code = (error as { code?: string }).code;
      let message =
        error instanceof Error ? error.message : "登录失败，请重试";
      if (code === "ACCOUNT_ALREADY_BOUND") {
        message =
          "该账号已绑定其他微信，请使用原微信登录，或联系客服解绑后重试";
      } else if (code === "WECHAT_ALREADY_BOUND") {
        message = "当前微信已绑定账号，请返回使用微信一键登录";
      }
      this.setData({ error: message });
    } finally {
      this.setData({ submitting: false });
    }
  },

  // ── 绑定码 ──
  onUseBindCode() {
    wx.navigateTo({ url: "/pages/auth/bind-code/page" });
  },
});
