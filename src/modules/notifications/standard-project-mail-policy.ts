import type { NotificationType, PlatformRole } from "@/generated/prisma/client";

export function isStandardProjectRecipientRelevant(input: {
  userId: string;
  platformRole: PlatformRole;
  notificationType: NotificationType;
  membershipUserIds: string[];
  projectManagerUserIds: string[];
}) {
  // 项目人员变动是发给当事人本人的内部提醒：他可能刚被移出项目、也可能是
  // 技术人员（不在 projectManagerUserIds 里），这里不再要求「仍在项目内」。
  if (input.notificationType === "PROJECT_STAFF") {
    return input.platformRole !== "CUSTOMER";
  }
  return (
    (input.platformRole === "CUSTOMER" &&
      input.membershipUserIds.includes(input.userId)) ||
    (input.notificationType === "PROJECT_CREATED" &&
      input.projectManagerUserIds.includes(input.userId))
  );
}

export function canSendStandardProjectEmailForModule(input: {
  notificationType: NotificationType;
  customerUpdatesEnabled: boolean;
  customerFilesEnabled: boolean;
  showMilestones: boolean;
  showProgress: boolean;
}) {
  if (input.notificationType === "PROJECT_CREATED") return true;
  // 内部提醒，与客户可见性开关无关
  if (input.notificationType === "PROJECT_STAFF") return true;
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
