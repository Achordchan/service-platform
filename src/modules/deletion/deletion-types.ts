export const deletionResourceTypes = [
  "CUSTOMER_SPACE",
  "STAFF_USER",
  "PROJECT",
  "SERVICE_TYPE",
  "REQUEST_CATEGORY",
  "ROLE_GROUP",
] as const;

export type DeletionResourceType = (typeof deletionResourceTypes)[number];
export type DeletionCheckStatus = "PASS" | "WARN" | "BLOCK";

export type DeletionCheck = {
  key: string;
  label: string;
  status: DeletionCheckStatus;
  message: string;
  count?: number;
  actionHref?: string;
  actionLabel?: string;
};

export type DeletionImpact = {
  key: string;
  label: string;
  count: number;
  action: "DELETE" | "DETACH" | "PRESERVE";
};

export type DeletionReport = {
  resourceType: DeletionResourceType;
  resourceId: string;
  resourceLabel: string;
  allowed: boolean;
  confirmationMode: "SIMPLE" | "TYPE_NAME";
  checks: DeletionCheck[];
  impacts: DeletionImpact[];
  checkedAt: string;
};
