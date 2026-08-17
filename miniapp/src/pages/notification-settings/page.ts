import { ensureLoggedIn } from "../../lib/auth";
import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from "../../lib/api";
import {
  fetchSubscribeState,
  requestSubscribe,
  clearBannerDismiss,
  type SubscribeTemplateState,
} from "../../lib/subscribe";

Page({
  data: {
    loading: true,
    loadError: "",
    soundEnabled: true,
    emailEnabled: true,
    saving: false,
    // 微信订阅真实状态
    wechatConfigured: false,
    wechatTemplates: [] as SubscribeTemplateState[],
    wechatAllSubscribed: false,
    wechatMissingCount: 0,
    subscribing: false,
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
      const [prefs, subscribeState] = await Promise.all([
        getNotificationPreferences(),
        fetchSubscribeState(),
      ]);
      this.setData({
        loading: false,
        soundEnabled: prefs.soundNotificationsEnabled,
        emailEnabled: prefs.requestEmailNotificationsEnabled,
        wechatConfigured: subscribeState.configured,
        wechatTemplates: subscribeState.templates,
        wechatAllSubscribed: subscribeState.allSubscribed,
        wechatMissingCount: subscribeState.missingCount,
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
  // 拉起微信订阅授权（首开或补充未订阅的模板），成功后刷新真实状态
  async onSubscribeReminders() {
    if (this.data.subscribing) return;
    if (!this.data.wechatConfigured) {
      wx.showModal({
        title: "暂未开放",
        content: "微信订阅消息模板配置完成后即可开启提醒。",
        showCancel: false,
      });
      return;
    }
    this.setData({ subscribing: true });
    try {
      const accepted = await requestSubscribe(this.data.wechatTemplates);
      wx.showToast({
        title: accepted > 0 ? `已开启 ${accepted} 类提醒` : "未开启提醒",
        icon: "none",
      });
      // 订阅状态有变化：清掉顶部横幅的「暂时忽略」，让横幅按最新状态即时反映
      if (accepted > 0) clearBannerDismiss();
      await this.load();
    } catch {
      wx.showToast({ title: "授权未完成", icon: "none" });
    } finally {
      this.setData({ subscribing: false });
    }
  },
});
