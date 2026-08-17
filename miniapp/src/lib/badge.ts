import { getNotificationSummary } from "./api";
import { eventSync } from "./events";
import { getToken } from "./auth";

const BADGE_TAB_INDEX = 2;
let refreshing = false;

async function refreshBadge() {
  if (refreshing || !getToken()) return;
  refreshing = true;
  try {
    const summary = await getNotificationSummary();
    if (summary.totalUnread > 0) {
      await wx.setTabBarBadge({
        index: BADGE_TAB_INDEX,
        text: summary.totalUnread > 99 ? "99+" : String(summary.totalUnread),
      });
    } else {
      await wx.removeTabBarBadge({ index: BADGE_TAB_INDEX });
    }
  } catch {
    // 角标失败静默：不影响页面
  } finally {
    refreshing = false;
  }
}

let bound = false;

/** 各 Tab 页 onShow 调用；事件回调（NOTIFICATION_CREATED）自动刷新 */
export function ensureBadgeSync() {
  void refreshBadge();
  if (bound) return;
  bound = true;
  eventSync.on((events) => {
    if (events.some((event) => event.type === "NOTIFICATION_CREATED")) {
      void refreshBadge();
    }
  });
}
