import type { MailMessageStatus } from "@/generated/prisma/client";

const STATUS_BY_EVENT: Record<string, MailMessageStatus | undefined> = {
  "email.sent": "SENT",
  "email.delivered": "DELIVERED",
  "email.delivery_delayed": "DELIVERY_DELAYED",
  "email.failed": "FAILED",
  "email.bounced": "BOUNCED",
  "email.complained": "COMPLAINED",
  "email.suppressed": "SUPPRESSED",
};

const STATUS_PRIORITY: Record<MailMessageStatus, number> = {
  QUEUED: 0,
  PROCESSING: 1,
  SENT: 2,
  DELIVERY_DELAYED: 3,
  DELIVERED: 4,
  FAILED: 5,
  BOUNCED: 5,
  SUPPRESSED: 5,
  COMPLAINED: 6,
  CANCELLED: 7,
};

export function resendEventToMessageStatus(type: string) {
  return STATUS_BY_EVENT[type] ?? null;
}

export function shouldApplyMailEvent(input: {
  currentStatus: MailMessageStatus;
  currentEventAt: Date | null;
  nextStatus: MailMessageStatus;
  nextEventAt: Date;
}) {
  if (!input.currentEventAt) return true;
  const timeDifference =
    input.nextEventAt.getTime() - input.currentEventAt.getTime();
  if (timeDifference < 0) return false;
  return (
    STATUS_PRIORITY[input.nextStatus] >=
    STATUS_PRIORITY[input.currentStatus]
  );
}
