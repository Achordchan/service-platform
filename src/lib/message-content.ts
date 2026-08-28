export function htmlToPlainText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function hasMeaningfulHtml(html: string) {
  return (
    htmlToPlainText(html).length > 0 ||
    extractInlineAttachmentIds(html).length > 0
  );
}

export function extractInlineAttachmentIds(html: string) {
  const ids = new Set<string>();
  for (const match of html.matchAll(/attachment:\/\/([a-z0-9_-]+)/gi)) {
    if (match[1]) ids.add(match[1]);
    if (ids.size > 20) break;
  }
  return Array.from(ids);
}

export function resolveInlineAttachmentHtml(
  html: string,
  resolveUrl: (attachmentId: string) => string = (attachmentId) =>
    `/api/v1/attachments/${attachmentId}?disposition=inline`,
) {
  return html.replace(
    /<img\b[^>]*\bdata-attachment-id=["']([a-z0-9_-]+)["'][^>]*>/gi,
    (tag, attachmentId: string) => {
      const url = resolveUrl(attachmentId);
      if (!url || url === "about:blank") return "";
      const escapedUrl = url
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return tag.replace(
        /\bsrc=["']attachment:\/\/[a-z0-9_-]+["']/i,
        `src="${escapedUrl}"`,
      );
    },
  );
}

export function escapeHtmlText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function truncatePlainText(value: string, maxLength = 120) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

export function buildMessagePreview(html: string, maxLength = 120) {
  return truncatePlainText(htmlToPlainText(html), maxLength);
}

// 纯附件回复的占位正文：不含文件名。正文是不可变的历史记录，而附件（标题、
// 存废）是可变的，二者一旦耦合就会在改名/撤回/部分上传失败时产生过时或泄露。
// 展示端（replyText / 引用预览）改从实时附件列表重建，服务端据此哨兵判定占位。
export const ATTACHMENT_ONLY_MESSAGE_SENTINEL = "附件";

export function buildAttachmentOnlyMessage() {
  return `<p>${ATTACHMENT_ONLY_MESSAGE_SENTINEL}</p>`;
}

// 服务端权威判定：正文是否为纯附件回复占位（哨兵且存在非内联附件）
export function isAttachmentOnlyBody(
  body: string,
  hasNonInlineAttachment: boolean,
) {
  return (
    hasNonInlineAttachment &&
    htmlToPlainText(body).trim() === ATTACHMENT_ONLY_MESSAGE_SENTINEL
  );
}
