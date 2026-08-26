import { isLoggedIn } from "../../lib/auth";
import {
  fetchSubscribeState,
  requestSubscribe,
  isBannerDismissed,
  dismissBanner,
  hasAutoPrompted,
  markAutoPrompted,
  type SubscribeTemplateState,
} from "../../lib/subscribe";

/**
 * 订阅引导横幅：挂在各 Tab 页顶部。
 * - 首次进入（未做过引导）：主动弹窗引导用户开启微信提醒；
 * - 之后若仍未全部订阅：顶部显示黄色横幅推荐订阅，允许「暂时忽略」。
 * 已全部订阅 / 未登录 / 模板未配置时不显示，避免打扰。
 */
Component({
  data: {
    visible: false,
    templates: [] as SubscribeTemplateState[],
  },
  pageLifetimes: {
    show() {
      void this.refresh();
    },
  },
  methods: {
    async refresh() {
      if (!isLoggedIn()) {
        this.setData({ visible: false });
        return;
      }
      const state = await fetchSubscribeState().catch(() => null);
      // 拉取途中被作废（换账号 / 从微信设置返回）：这份已陈旧，别动 UI，
      // 否则会覆盖新一轮刚写好的授权状态（Codex P2）
      if (state?.stale) return;
      // 未配置模板或已全部订阅：无需引导
      if (!state || !state.configured || state.allSubscribed) {
        this.setData({ visible: false });
        return;
      }
      this.setData({ templates: state.templates });
      // 首屏主动引导（每设备仅一次）：弹窗解释价值后拉起授权
      if (!hasAutoPrompted()) {
        markAutoPrompted();
        this.autoPrompt();
        return;
      }
      // 已引导过：未被忽略才显示横幅
      this.setData({ visible: !isBannerDismissed() });
    },
    autoPrompt() {
      wx.showModal({
        title: "开启微信提醒",
        content:
          "工单有新回复、状态变化或项目动态时，第一时间通过微信提醒你，不错过重要进展。",
        confirmText: "立即开启",
        cancelText: "以后再说",
        success: (res) => {
          if (res.confirm) {
            // showModal 确认回调属用户点击，可合法拉起订阅授权
            void this.doSubscribe();
          } else {
            this.setData({ visible: !isBannerDismissed() });
          }
        },
        fail: () => {
          this.setData({ visible: !isBannerDismissed() });
        },
      });
    },
    async doSubscribe() {
      try {
        const accepted = await requestSubscribe(this.data.templates);
        if (accepted > 0) {
          wx.showToast({ title: `已开启 ${accepted} 类提醒`, icon: "none" });
        }
      } catch {
        // 用户取消授权：静默，横幅仍按状态展示
      }
      await this.refresh();
    },
    onEnable() {
      void this.doSubscribe();
    },
    onIgnore() {
      dismissBanner();
      this.setData({ visible: false });
    },
  },
});
