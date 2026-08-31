import {
  feedbackForSubscribeFailure,
  feedbackForSubscribeOutcome,
  type SubscribeFeedback,
  type SubscribeRequestOutcome,
} from "./subscribe-permission";

function showModal(feedback: SubscribeFeedback): Promise<boolean> {
  return new Promise((resolve) => {
    wx.showModal({
      title: feedback.title,
      content: feedback.content ?? "",
      confirmText: feedback.openSettings ? "去设置" : "知道了",
      showCancel: Boolean(feedback.openSettings),
      success: (result) =>
        resolve(Boolean(result.confirm && feedback.openSettings)),
      fail: () => resolve(false),
    });
  });
}

function openSubscribeSettings(): Promise<boolean> {
  return new Promise((resolve) => {
    wx.openSetting({
      withSubscriptions: true,
      success: () => resolve(true),
      fail: () => resolve(false),
    });
  });
}

async function presentFeedback(feedback: SubscribeFeedback): Promise<boolean> {
  if (feedback.mode === "toast") {
    wx.showToast({ title: feedback.title, icon: "none" });
    return false;
  }
  const shouldOpenSettings = await showModal(feedback);
  if (!shouldOpenSettings) return false;
  const opened = await openSubscribeSettings();
  if (!opened) {
    wx.showToast({ title: "无法打开微信设置，请稍后重试", icon: "none" });
  }
  return opened;
}

/** 返回 true 表示已打开微信设置，页面会通过 onShow 自行刷新。 */
export function presentSubscribeOutcome(
  outcome: SubscribeRequestOutcome,
): Promise<boolean> {
  return presentFeedback(feedbackForSubscribeOutcome(outcome));
}

/** 返回 true 表示已打开微信设置，页面会通过 onShow 自行刷新。 */
export function presentSubscribeFailure(error: unknown): Promise<boolean> {
  return presentFeedback(feedbackForSubscribeFailure(error));
}
