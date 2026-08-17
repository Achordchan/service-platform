// 对齐 Web 端 src/lib/status-config.ts 的客户可见文案与色调
export type RequestStatusValue =
  | "PENDING"
  | "IN_PROGRESS"
  | "WAITING_CUSTOMER"
  | "RESOLVED"
  | "CLOSED";

// 小程序仅面向客户：文案采用客户视角（与 Web statusLabelFor(status, "CUSTOMER") 一致）
export const REQUEST_STATUS_LABELS: Record<RequestStatusValue, string> = {
  PENDING: "待处理",
  IN_PROGRESS: "处理中",
  WAITING_CUSTOMER: "等待您回复",
  RESOLVED: "已解决",
  CLOSED: "已关闭",
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

// 项目动态正文中的内嵌图片（attachment:// 协议）在小程序 rich-text 里无法
// 携带登录态加载；提取为独立图片列表（点击下载预览），并从 HTML 中移除 img。
export function extractInlineImages(html: string): {
  html: string;
  images: Array<{ id: string; name: string }>;
} {
  const images: Array<{ id: string; name: string }> = [];
  let index = 0;
  const cleaned = html.replace(
    /<img\b[^>]*?(?:data-attachment-id|src=["']attachment:\/\/)([a-z0-9_-]+)[^>]*>/gi,
    (_match, id: string) => {
      index += 1;
      images.push({ id, name: `内嵌图片 ${index}` });
      return "";
    },
  );
  return { html: cleaned, images };
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
