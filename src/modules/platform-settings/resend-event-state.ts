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
  SENT: 1,
  DELIVERY_DELAYED: 2,
  DELIVERED: 3,
  FAILED: 4,
  BOUNCED: 4,
  SUPPRESSED: 4,
  COMPLAINED: 5,
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
