import type { RequestStatus } from "@/components/customer/customer-types";

export function shouldShowResolvedReplyGate(status: RequestStatus) {
  return status === "RESOLVED";
}
