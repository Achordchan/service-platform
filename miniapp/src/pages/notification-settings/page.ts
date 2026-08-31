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
import {
  presentSubscribeFailure,
  presentSubscribeOutcome,
} from "../../lib/subscribe-ui";

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
    if (!ensureLoggedIn(() => this.load())) return;
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
      // 订阅状态拉取途中被作废（换账号 / 从微信设置返回）：这次 load 已被新一轮取代，
      // 跳过写 UI，保留新一轮的结果；loading 等收尾由那一轮完成（Codex P2）
      if (subscribeState.stale) return;
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
    let openedSettings = false;
    try {
      const outcome = await requestSubscribe(this.data.wechatTemplates);
      // 订阅状态有变化：清掉顶部横幅的「暂时忽略」，让横幅按最新状态即时反映
      if (outcome.acceptedCount > 0) clearBannerDismiss();
      openedSettings = await presentSubscribeOutcome(outcome);
    } catch (error) {
      openedSettings = await presentSubscribeFailure(error);
    } finally {
      this.setData({ subscribing: false });
    }
    // 打开设置后由 onShow 重拉，避免并发两轮 load 用陈旧状态覆盖新结果。
    if (!openedSettings) await this.load();
  },
});
