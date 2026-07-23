import type { ProjectStatus } from "@/components/staff/staff-types";

export function isProjectDeliveryActive(status: ProjectStatus) {
  return status !== "DRAFT";
}
