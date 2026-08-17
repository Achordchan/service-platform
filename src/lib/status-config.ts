export type StatusValue =
  | "DRAFT"
  | "ACTIVE"
  | "PAUSED"
  | "COMPLETED"
  | "EXPIRED"
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "PENDING"
  | "WAITING_CUSTOMER"
  | "RESOLVED"
  | "CLOSED";

type StatusTone = "neutral" | "info" | "warning" | "success" | "waiting" | "error";

const statusConfig: Record<StatusValue, { label: string; tone: StatusTone; labelCustomer?: string }> = {
  DRAFT: { label: "待接入", tone: "neutral" },
  ACTIVE: { label: "进行中", tone: "info" },
  PAUSED: { label: "已暂停", tone: "warning" },
  COMPLETED: { label: "已完成", tone: "success" },
  EXPIRED: { label: "已到期", tone: "error" },
  NOT_STARTED: { label: "未开始", tone: "neutral" },
  IN_PROGRESS: { label: "处理中", tone: "info" },
  PENDING: { label: "待处理", tone: "warning" },
  WAITING_CUSTOMER: { label: "等待客户", tone: "waiting", labelCustomer: "等待您回复" },
  RESOLVED: { label: "已解决", tone: "success" },
  CLOSED: { label: "已关闭", tone: "neutral" },
};

export type StatusAudience = "CUSTOMER" | "STAFF";

/**
 * 按受众取状态文案：同一状态在不同视角下表述不同
 * （如 WAITING_CUSTOMER 员工看是"等待客户"，客户看是"等待您回复"）。
 * 不传 audience 时保持原有全局文案，兼容存量调用与测试。
 */
export function statusLabelFor(
  status: StatusValue,
  audience?: StatusAudience,
): string {
  const config = statusConfig[status];
  if (audience === "CUSTOMER" && config.labelCustomer) {
    return config.labelCustomer;
  }
  return config.label;
}

/**
 * Returns a theme palette path usable directly in an `sx` color prop, so status
 * components stay renderable from server components (no `useTheme()` needed).
 */
export function statusColorFor(status: StatusValue): string {
  switch (statusConfig[status].tone) {
    case "info":
      return "primary.main";
    case "warning":
      return "warning.main";
    case "success":
      return "success.main";
    case "error":
      return "error.main";
    case "waiting":
      return "info.dark";
    case "neutral":
    default:
      return "text.secondary";
  }
}
