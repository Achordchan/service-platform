export function notificationEmailDueAt(
  unreadDelayEnabled: boolean,
  now = new Date(),
) {
  return new Date(now.getTime() + (unreadDelayEnabled ? 5 * 60 * 1000 : 0));
}
