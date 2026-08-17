import { ensureLoggedIn } from "../../lib/auth";
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  reportSubscribeGrant,
  getSubscribeMessageConfig,
  type SubscribeTemplateConfig,
} from "../../lib/api";

Page({
  data: {
    loading: true,
    loadError: "",
    soundEnabled: true,
    emailEnabled: true,
    saving: false,
    templates: [] as SubscribeTemplateConfig[],
  },
  onShow() {
    if (!ensureLoggedIn()) return;
    void this.load();
  },
  onRetry() {
    void this.load();
  },
  async load() {
    this.setData({ loading: true, loadError: "" });
    try {
      const [prefs, config] = await Promise.all([
        getNotificationPreferences(),
        getSubscribeMessageConfig().catch(() => ({ templates: [] })),
      ]);
      this.setData({
        loading: false,
        soundEnabled: prefs.soundNotificationsEnabled,
        emailEnabled: prefs.requestEmailNotificationsEnabled,
        templates: config.templates,
      });
    } catch (error) {
      this.setData({
        loading: false,
        loadError:
          error instanceof Error ? error.message : "加载失败，请返回重试",
      });
    }
  },
  async onToggleSound() {
    const next = !this.data.soundEnabled;
    this.setData({ soundEnabled: next, saving: true });
    try {
      await updateNotificationPreferences({ soundNotificationsEnabled: next });
    } catch {
      this.setData({ soundEnabled: !next });
      wx.showToast({ title: "保存失败", icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  },
  async onToggleEmail() {
    const next = !this.data.emailEnabled;
    this.setData({ emailEnabled: next, saving: true });
    try {
      await updateNotificationPreferences({
        requestEmailNotificationsEnabled: next,
      });
    } catch {
      this.setData({ emailEnabled: !next });
      wx.showToast({ title: "保存失败", icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  },
  async onSubscribeReminders() {
    if (this.data.templates.length === 0) {
      wx.showModal({
        title: "暂未开放",
        content: "微信订阅消息模板配置完成后即可开启提醒。",
        showCancel: false,
      });
      return;
    }
    const templateIds = this.data.templates.map((item) => item.templateId);
    try {
      const result = await wx.requestSubscribeMessage({ tmplIds: templateIds });
      let accepted = 0;
      for (const template of this.data.templates) {
        if (result[template.templateId] === "accept") {
          await reportSubscribeGrant(template.templateKey).catch(
            () => undefined,
          );
          accepted += 1;
        }
      }
      wx.showToast({
        title: accepted > 0 ? `已开启 ${accepted} 类提醒` : "未开启提醒",
        icon: "none",
      });
    } catch {
      wx.showToast({ title: "授权未完成", icon: "none" });
    }
  },
});
