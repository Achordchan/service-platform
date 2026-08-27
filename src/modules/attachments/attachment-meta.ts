// 附件标题/备注的归一化与风控文本拼装。
// 独立小模块：无 server-only 依赖，便于服务层复用与单元测试。

export const ATTACHMENT_TITLE_MAX_LENGTH = 160;
export const ATTACHMENT_NOTE_MAX_LENGTH = 500;

// 标题为空时不落库，展示端兜底 originalName；originalName 仍是下载文件名
export function normalizeAttachmentTitle(title: string | undefined) {
  const normalized = title
    ?.replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, ATTACHMENT_TITLE_MAX_LENGTH);
  return normalized || null;
}

// 备注允许换行（\u000A），其余控制字符剔除
export function normalizeAttachmentNote(note: string | undefined) {
  const normalized = note
    ?.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "")
    .trim()
    .slice(0, ATTACHMENT_NOTE_MAX_LENGTH);
  return normalized || null;
}

// 标题与备注是用户可编辑的公开文本，必须和文件名一起进内容风控
export function attachmentRiskText(
  fileName: string,
  title: string | null,
  note: string | null,
) {
  return [fileName, title, note]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

// 允许浏览器内联展示（在线预览）的类型白名单。
// 刻意排除 html/svg 等可执行内容——附件校验层本就不放行它们，这里再兜一层。
export function isInlinePreviewableMimeType(mimeType: string) {
  return (
    mimeType.startsWith("image/") ||
    mimeType === "application/pdf" ||
    isTextPreviewMimeType(mimeType)
  );
}

// 需要以文本形式渲染预览的类型（Web 弹层 / 小程序文本查看页）
export function isTextPreviewMimeType(mimeType: string) {
  return (
    mimeType === "text/plain" ||
    mimeType === "text/csv" ||
    mimeType === "application/json"
  );
}
