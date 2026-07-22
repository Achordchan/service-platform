export type NotificationLocalUpdateDetail = {
  all?: boolean;
  notificationId?: string;
  serviceRequestId?: string;
  projectId?: string;
  projectScope?: "overview" | "updates" | "milestones" | "files" | "all";
};

type NotificationLocalUpdateItem = {
  id: string;
  type: string;
  projectId?: string | null;
  serviceRequestId?: string | null;
};

function matchesProjectScope(type: string, scope?: NotificationLocalUpdateDetail["projectScope"]) {
  if (scope === "all") return true;
  if (scope === "overview") return type === "PROJECT_STAGE";
  if (scope === "milestones") return type === "PROJECT_MILESTONE";
  if (scope === "files") return type === "PROJECT_FILE";
  return type === "PROJECT_UPDATE" || type === "UPDATE_COMMENT";
}

export function matchesNotificationLocalUpdate(
  item: NotificationLocalUpdateItem,
  detail: NotificationLocalUpdateDetail,
) {
  if (detail.all) return true;
  if (detail.notificationId === item.id) return true;
  if (
    detail.serviceRequestId &&
    detail.serviceRequestId === item.serviceRequestId
  ) {
    return true;
  }
  if (!detail.projectId || detail.projectId !== item.projectId) return false;
  return matchesProjectScope(item.type, detail.projectScope);
}
