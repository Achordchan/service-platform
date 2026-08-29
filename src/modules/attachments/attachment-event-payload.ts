import "server-only";

/**
 * 附件派生事件（优化完成 / 预览就绪）的 payload。
 *
 * 必须带上归属实体 id：realtime-event-visibility 按 projectUpdateId /
 * updateCommentId / milestoneId 决定这条事件归哪个模块（与 RLS 的
 * app_project_attachment_feature_enabled 同口径）。不带的话一律落到「项目文件」，
 * 「开着动态、关着文件」的客户就刷不出动态附件的新元数据与预览入口。
 */
export function attachmentEventPayload(attachment: {
  id: string;
  projectUpdateId?: string | null;
  updateCommentId?: string | null;
  milestoneId?: string | null;
  requestMessageId?: string | null;
}) {
  return {
    attachmentId: attachment.id,
    ...(attachment.projectUpdateId
      ? { projectUpdateId: attachment.projectUpdateId }
      : {}),
    ...(attachment.updateCommentId
      ? { updateCommentId: attachment.updateCommentId }
      : {}),
    ...(attachment.milestoneId ? { milestoneId: attachment.milestoneId } : {}),
    ...(attachment.requestMessageId
      ? { requestMessageId: attachment.requestMessageId }
      : {}),
  };
}
