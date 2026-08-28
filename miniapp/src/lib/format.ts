// 对齐 Web 端 src/lib/status-config.ts 的客户可见文案与色调
export type RequestStatusValue =
  | "PENDING"
  | "IN_PROGRESS"
  | "WAITING_CUSTOMER"
  | "RESOLVED"
  | "CLOSED";

// 客户视角文案（与 Web statusLabelFor(status, "CUSTOMER") 一致）
export const REQUEST_STATUS_LABELS: Record<RequestStatusValue, string> = {
  PENDING: "待处理",
  IN_PROGRESS: "处理中",
  WAITING_CUSTOMER: "等待您回复",
  RESOLVED: "已解决",
  CLOSED: "已关闭",
};

// 员工视角文案（与 Web statusLabelFor(status, "STAFF") 一致）：WAITING_CUSTOMER 表述不同
export const REQUEST_STATUS_LABELS_STAFF: Record<RequestStatusValue, string> = {
  ...REQUEST_STATUS_LABELS,
  WAITING_CUSTOMER: "等待客户",
};

/** 按登录身份取工单状态文案（后台模式下「等待您回复」会误导员工） */
export function requestStatusLabel(status: string, staffView: boolean): string {
  const labels = staffView ? REQUEST_STATUS_LABELS_STAFF : REQUEST_STATUS_LABELS;
  return labels[status as RequestStatusValue] ?? status;
}

export const PLATFORM_ROLE_LABELS: Record<string, string> = {
  CUSTOMER: "客户",
  PROJECT_MANAGER: "项目经理",
  TECHNICIAN: "技术人员",
  PLATFORM_ADMIN: "平台管理员",
};

export type MilestoneStatusValue = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";

export const MILESTONE_STATUS_LABELS: Record<MilestoneStatusValue, string> = {
  NOT_STARTED: "未开始",
  IN_PROGRESS: "进行中",
  COMPLETED: "已完成",
};

export const MILESTONE_STATUS_TONES: Record<MilestoneStatusValue, string> = {
  NOT_STARTED: "neutral",
  IN_PROGRESS: "info",
  COMPLETED: "success",
};

export const REQUEST_STATUS_TONES: Record<RequestStatusValue, string> = {
  PENDING: "warning",
  IN_PROGRESS: "info",
  WAITING_CUSTOMER: "warning",
  RESOLVED: "success",
  CLOSED: "neutral",
};

export type RequestPriorityValue = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export const REQUEST_PRIORITY_LABELS: Record<RequestPriorityValue, string> = {
  LOW: "低",
  NORMAL: "普通",
  HIGH: "高",
  URGENT: "紧急",
};

export const REQUEST_PRIORITY_TONES: Record<RequestPriorityValue, string> = {
  LOW: "neutral",
  NORMAL: "info",
  HIGH: "warning",
  URGENT: "error",
};

export type ProjectStatusValue =
  | "DRAFT"
  | "ACTIVE"
  | "PAUSED"
  | "COMPLETED"
  | "EXPIRED";

export const PROJECT_STATUS_TONES: Record<ProjectStatusValue, string> = {
  DRAFT: "neutral",
  ACTIVE: "success",
  PAUSED: "warning",
  COMPLETED: "info",
  EXPIRED: "warning",
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatusValue, string> = {
  DRAFT: "未启动",
  ACTIVE: "进行中",
  PAUSED: "已暂停",
  COMPLETED: "已完成",
  EXPIRED: "已到期",
};

// 首页问候：时段 + 姓名（一行内，低调）
export function greetingFor(
  name: string | null | undefined,
  now: Date = new Date(),
): string {
  const hour = now.getHours();
  const period =
    hour < 5
      ? "凌晨好"
      : hour < 11
        ? "早上好"
        : hour < 14
          ? "中午好"
          : hour < 18
            ? "下午好"
            : "晚上好";
  return name ? `${period}，${name}` : period;
}

export function todayLabel(now: Date = new Date()): string {
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  return `${now.getMonth() + 1}月${now.getDate()}日 周${weekdays[now.getDay()]}`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatRelative(value: string | null | undefined): string {
  if (!value) return "—";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "—";
  const diff = Date.now() - time;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return formatDateTime(value).slice(0, 10);
}

// 附件类型徽章：按 mimeType 推导 2-4 位扩展名标签（替代 emoji 图标）
export function fileExtLabel(mimeType: string, fileName?: string): string {
  const fromName = fileName?.match(/\.([a-z0-9]{1,5})$/i)?.[1]?.toUpperCase();
  if (fromName && fromName.length <= 4) return fromName;
  const map: Record<string, string> = {
    "image/": "IMG",
    "application/pdf": "PDF",
    "text/": "TXT",
    "application/msword": "DOC",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOC",
    "application/vnd.ms-excel": "XLS",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLS",
    "application/vnd.ms-powerpoint": "PPT",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPT",
    "application/zip": "ZIP",
  };
  for (const [prefix, label] of Object.entries(map)) {
    if (mimeType.startsWith(prefix)) return label;
  }
  return "FILE";
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// 富文本 HTML → 纯文本摘要（列表/通知用；详情用 rich-text 渲染）
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// 用户输入拼接进富文本前必须转义，否则服务端 sanitize 会吞掉 < & 等字符
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// 正文内嵌图片（attachment:// 协议）在小程序 rich-text 里无法携带登录态加载，
// 直接渲染就是一张裂图。提取成独立图片列表（点击下载预览）并从 HTML 中移除。
// 第二个 replace 是兜底：任何没能匹配出 id 的 <img> 也一并删掉 —— 宁可不显示，
// 也不能把裂图留在气泡里。
export function extractInlineImages(html: string): {
  html: string;
  images: Array<{ id: string; name: string }>;
} {
  const images: Array<{ id: string; name: string }> = [];
  let index = 0;
  const cleaned = html
    .replace(
      /<img\b[^>]*?(?:data-attachment-id|src=["']attachment:\/\/)([a-z0-9_-]+)[^>]*>/gi,
      (_match, id: string) => {
        index += 1;
        images.push({ id, name: `内嵌图片 ${index}` });
        return "";
      },
    )
    .replace(/<img\b[^>]*>/gi, "");
  return { html: cleaned, images };
}

/**
 * 取出正文里的内嵌图 <img> 原样标签。
 *
 * 小程序的编辑器是纯文本：htmlToText 会把 <img> 一起吃掉，若照常提交重建的正文，
 * 服务端会把「正文里消失的附件 id」判定为删除，连附件行和存储文件一起删 ——
 * 于是从小程序改一下标题，就把 Web 上传的正文配图永久删了。保存时把这些标签
 * 原样接回去，id 就不会从正文里消失。
 */
export function keepInlineImageTags(html: string): string {
  return (html.match(/<img\b[^>]*>/gi) ?? []).join("");
}

// 通知类型 → 项目详情目标 tab（消息点击直达对应区域）
export function notificationTargetTab(type: string): string {
  switch (type) {
    case "PROJECT_UPDATE":
    case "UPDATE_COMMENT":
      return "updates";
    case "PROJECT_MILESTONE":
      return "milestones";
    case "PROJECT_FILE":
      return "files";
    default:
      // PROJECT_CREATED / PROJECT_STAGE 等在概览呈现
      return "overview";
  }
}

export function genMutationKey(): string {
  return `ma-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** 文本类附件（openDocument 不支持）改走文本查看页 */
export function isTextAttachment(mimeType: string) {
  return (
    mimeType === "text/plain" ||
    mimeType === "text/csv" ||
    mimeType === "application/json"
  );
}
