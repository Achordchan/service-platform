import type { RequestStatus } from "@/generated/prisma/client";
import { conflict } from "./errors";

const allowedTransitions: Record<RequestStatus, readonly RequestStatus[]> = {
  PENDING: ["IN_PROGRESS", "WAITING_CUSTOMER"],
  IN_PROGRESS: ["WAITING_CUSTOMER", "RESOLVED"],
  WAITING_CUSTOMER: ["IN_PROGRESS", "RESOLVED"],
  RESOLVED: ["IN_PROGRESS", "CLOSED"],
  CLOSED: [],
};

export function canTransitionRequest(
  from: RequestStatus,
  to: RequestStatus,
) {
  return allowedTransitions[from].includes(to);
}

export function assertRequestTransition(
  from: RequestStatus,
  to: RequestStatus,
) {
  if (!canTransitionRequest(from, to)) {
    throw conflict(
      "INVALID_REQUEST_STATUS_TRANSITION",
      `请求状态不能从 ${from} 变更为 ${to}`,
    );
  }
}

export function statusAfterCustomerReply(status: RequestStatus) {
  if (status === "RESOLVED" || status === "WAITING_CUSTOMER") {
    return "IN_PROGRESS" satisfies RequestStatus;
  }
  return status;
}

export function statusAfterStaffPublicReply(status: RequestStatus) {
  if (status === "PENDING" || status === "IN_PROGRESS") {
    return "WAITING_CUSTOMER" satisfies RequestStatus;
  }
  return status;
}

