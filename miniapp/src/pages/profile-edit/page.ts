import { ensureLoggedIn, fetchMeCached, clearCachedMe } from "../../lib/auth";
import {
  updateProfileName,
  uploadProfileAvatar,
  getEmailChange,
  requestEmailChange,
  cancelEmailChange,
  type PendingEmailChange,
} from "../../lib/api";

Page({
  data: {
    loading: true,
    loadError: "",
    name: "",
    email: "",
    avatarPreview: "",
    saving: false,
    // 邮箱变更
    pendingChange: null as PendingEmailChange,
    newEmail: "",
    emailBusy: false,
    showEmailForm: false,
  },
  avatarFile: "",

  onLoad() {
    void this.bootstrap();
  },
  onShow() {
    if (!ensureLoggedIn()) return;
  },
  onRetry() {
    void this.bootstrap();
  },
  async bootstrap() {
    this.setData({ loading: true, loadError: "" });
    try {
      const [me, pending] = await Promise.all([
        fetchMeCached(),
        getEmailChange().catch(() => null),
      ]);
      this.setData({
        loading: false,
        name: me.user.name,
        email: me.user.email,
        pendingChange: pending,
      });
    } catch (error) {
      this.setData({
        loading: false,
        loadError:
          error instanceof Error ? error.message : "加载失败，请重试",
      });
    }
  },
  onNameInput(event: WechatMiniprogram.Input) {
    this.setData({ name: event.detail.value });
  },
  async onChooseAvatar() {
    try {
      const chosen = await wx.chooseMedia({
        count: 1,
        mediaType: ["image"],
        sizeType: ["compressed"],
      });
      const file = chosen.tempFiles[0];
      if (!file) return;
      this.avatarFile = file.tempFilePath;
      this.setData({ avatarPreview: file.tempFilePath });
    } catch {
      // 用户取消
    }
  },
  async onSave() {
    if (this.data.saving) return;
    const name = this.data.name.trim();
    if (name.length < 2) {
      wx.showToast({ title: "姓名至少 2 个字符", icon: "none" });
      return;
    }
    this.setData({ saving: true });
    try {
      if (this.avatarFile) {
        await uploadProfileAvatar({ filePath: this.avatarFile, name });
      } else {
        await updateProfileName(name);
      }
      this.avatarFile = "";
      clearCachedMe();
      this.setData({ avatarPreview: "" });
      wx.showToast({ title: "已保存", icon: "success" });
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "保存失败",
        icon: "none",
      });
    } finally {
      this.setData({ saving: false });
    }
  },

  // —— 邮箱变更：小程序内发起/取消；最终确认需在邮件链接中完成 ——
  onToggleEmailForm() {
    this.setData({
      showEmailForm: !this.data.showEmailForm,
      newEmail: "",
    });
  },
  onNewEmailInput(event: WechatMiniprogram.Input) {
    this.setData({ newEmail: event.detail.value });
  },
  async onRequestEmailChange() {
    if (this.data.emailBusy) return;
    const newEmail = this.data.newEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      wx.showToast({ title: "请输入有效邮箱", icon: "none" });
      return;
    }
    this.setData({ emailBusy: true });
    try {
      await requestEmailChange(newEmail);
      wx.showModal({
        title: "验证邮件已发送",
        content: `确认链接已发送到当前邮箱与新邮箱，请在邮件中点击链接完成变更。新邮箱：${newEmail}`,
        showCancel: false,
      });
      const pending = await getEmailChange().catch(() => null);
      this.setData({ pendingChange: pending, showEmailForm: false, newEmail: "" });
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "发起失败",
        icon: "none",
      });
    } finally {
      this.setData({ emailBusy: false });
    }
  },
  onCancelEmailChange() {
    wx.showModal({
      title: "取消邮箱变更",
      content: "确定放弃当前待验证的邮箱变更申请？",
      success: (result) => {
        if (!result.confirm) return;
        void this.doCancelEmailChange();
      },
    });
  },
  async doCancelEmailChange() {
    this.setData({ emailBusy: true });
    try {
      await cancelEmailChange();
      this.setData({ pendingChange: null });
      wx.showToast({ title: "已取消", icon: "success" });
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "取消失败",
        icon: "none",
      });
    } finally {
      this.setData({ emailBusy: false });
    }
  },
});
