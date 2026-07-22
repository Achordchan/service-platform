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

export function buildAttachmentOnlyMessage(fileNames: string[]) {
  const names = fileNames
    .map((name) => name.trim())
    .filter(Boolean)
    .map(escapeHtmlText);
  return `<p>附件：${names.join("、") || "文件"}</p>`;
}
