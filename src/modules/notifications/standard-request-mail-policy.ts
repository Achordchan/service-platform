export function isStandardRequestRecipientRelevant(input: {
  userId: string;
  platformRole: string;
  membershipUserIds: string[];
  projectStaffUserIds: string[];
  assigneeUserIds: string[];
}) {
  if (input.platformRole === "PLATFORM_ADMIN") return true;
  if (input.platformRole === "CUSTOMER") {
    return input.membershipUserIds.includes(input.userId);
  }
  return (
    input.projectStaffUserIds.includes(input.userId) ||
    input.assigneeUserIds.includes(input.userId)
  );
}

export function canSendStandardRequestEmailForModule(input: {
  platformRole: string;
  customerRequestsEnabled: boolean;
}) {
  return (
    input.platformRole !== "CUSTOMER" || input.customerRequestsEnabled
  );
}

export function isCurrentMailRecipient(
  queuedEmail: string,
  currentEmail: string,
) {
  return queuedEmail.trim().toLowerCase() === currentEmail.trim().toLowerCase();
}
