export type NavigationUnreadState = {
  projects: boolean;
  requests: boolean;
};

export const EMPTY_NAVIGATION_UNREAD: NavigationUnreadState = {
  projects: false,
  requests: false,
};
