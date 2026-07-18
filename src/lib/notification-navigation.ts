export type NavigationUnreadState = {
  projects: boolean;
  requests: boolean;
};

type NotificationNavigationItem = {
  type: string;
  readAt?: string | null;
  serviceRequestId?: string | null;
};

export const EMPTY_NAVIGATION_UNREAD: NavigationUnreadState = {
  projects: false,
  requests: false,
};

export function summarizeNavigationUnread(
  items: readonly NotificationNavigationItem[],
): NavigationUnreadState {
  let projects = false;
  let requests = false;

  for (const item of items) {
    if (item.readAt) continue;
    if (item.serviceRequestId || item.type.startsWith("REQUEST_")) {
      requests = true;
    } else if (
      item.type === "PROJECT_UPDATE" ||
      item.type === "UPDATE_COMMENT"
    ) {
      projects = true;
    }
    if (projects && requests) break;
  }

  return { projects, requests };
}
