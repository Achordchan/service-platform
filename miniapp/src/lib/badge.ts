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
let leaseHeld = false;

/**
 * 各 Tab 页 onShow 调用；事件回调（NOTIFICATION_CREATED）自动刷新角标。
 *
 * 这里必须自己持有一份 SSE 租约：只有「消息」页和工单详情会 eventSync.start()，
 * 停在项目/工单/我的这些 Tab 上时根本没有连接，注册的监听永远不会触发 ——
 * 表现就是网页端发了消息，小程序停在首页一直没有红点。
 *
 * 租约取到就不释放（角标是全局的，不跟随页面进出），退出登录时由
 * releaseBadgeSync 归还，避免未登录还挂着一条已鉴权的流。
 */
export function ensureBadgeSync() {
  void refreshBadge();
  if (!bound) {
    bound = true;
    eventSync.on((events) => {
      if (events.some((event) => event.type === "NOTIFICATION_CREATED")) {
        void refreshBadge();
      }
    });
  }
  // 401 被踢下线由 session 的 onSessionEnd 直接调 releaseBadgeSync 归还；
  // 这里是兜底自愈（token 被其他路径清掉时），并负责重新登录后取回租约。
  // 冷启动 onShow 可能早于登录完成，未登录时不占租约。
  const hasToken = Boolean(getToken());
  if (leaseHeld && !hasToken) {
    leaseHeld = false;
    eventSync.stop();
  } else if (!leaseHeld && hasToken) {
    leaseHeld = true;
    eventSync.start();
  }
}

/** 退出登录 / 被踢：归还租约并清掉角标 */
export function releaseBadgeSync() {
  if (leaseHeld) {
    leaseHeld = false;
    eventSync.stop();
  }
  void wx.removeTabBarBadge({ index: BADGE_TAB_INDEX }).catch(() => undefined);
}
