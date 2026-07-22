import type { NotificationType, PlatformRole } from "@/generated/prisma/client";

export function isStandardProjectRecipientRelevant(input: {
  userId: string;
  platformRole: PlatformRole;
  membershipUserIds: string[];
}) {
  return (
    input.platformRole === "CUSTOMER" &&
    input.membershipUserIds.includes(input.userId)
  );
}

export function canSendStandardProjectEmailForModule(input: {
  notificationType: NotificationType;
  customerUpdatesEnabled: boolean;
  customerFilesEnabled: boolean;
  showMilestones: boolean;
  showProgress: boolean;
}) {
  if (
    input.notificationType === "PROJECT_UPDATE" ||
    input.notificationType === "UPDATE_COMMENT"
  ) {
    return input.customerUpdatesEnabled;
  }
  if (input.notificationType === "PROJECT_STAGE") {
    return input.showProgress;
  }
  if (input.notificationType === "PROJECT_MILESTONE") {
    return input.showMilestones || input.showProgress;
  }
  if (input.notificationType === "PROJECT_FILE") {
    return input.customerFilesEnabled;
  }
  return false;
}
