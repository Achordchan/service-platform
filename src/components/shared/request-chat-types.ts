export type ChatAttachment = {
  id: string;
  originalName: string;
  title?: string | null;
  note?: string | null;
  previewStatus?: "PENDING" | "READY" | "FAILED" | null;
  mimeType: string;
  size: number;
  inline?: boolean;
  createdAt: string;
  visibility?: "CUSTOMER_VISIBLE" | "INTERNAL";
  contentRiskStatus?: "PENDING" | "REVOKED" | null;
};

export type ChatReplyReference = {
  id: string;
  body: string;
  /** 服务端权威判定：正文是否为纯附件回复的生成占位（附件：<文件名列表>） */
  bodyIsAttachmentPlaceholder?: boolean;
  authorId: string;
  authorName: string;
  visibility?: "CUSTOMER_VISIBLE" | "INTERNAL";
  attachments: Array<{
    id: string;
    originalName: string;
    title?: string | null;
    inline?: boolean;
  }>;
};

export type ChatMessage = {
  id: string;
  body: string;
  bodyIsAttachmentPlaceholder?: boolean;
  authorId: string;
  authorName: string;
  authorImage?: string | null;
  authorPlatformRole?: string | null;
  authorSource?: "ACHORD" | "SUB2API" | "UNIVERSAL" | "SYSTEM";
  authorSourceKey?: string;
  authorSourceLabel?: string;
  createdAt: string;
  visibility?: "CUSTOMER_VISIBLE" | "INTERNAL";
  isSystem?: boolean;
  isInitial?: boolean;
  supportPlaybook?: SupportReplyPlaybook | null;
  replyToMessageId?: string | null;
  replyTo?: ChatReplyReference | null;
  attachments: ChatAttachment[];
  contentRiskStatus?: "PENDING" | "REVOKED" | null;
  contentRiskReason?: string | null;
  reeditBody?: string | null;
  reeditAttachmentCount?: number;
};

export type ChatReplyTarget = Pick<
  ChatMessage,
  | "id"
  | "body"
  | "bodyIsAttachmentPlaceholder"
  | "authorName"
  | "visibility"
  | "attachments"
>;

export type ChatReeditDraft = {
  version: number;
  requestId: string;
  messageId: string;
  body: string;
  attachmentCount: number;
};
import type { SupportReplyPlaybook } from "@/lib/support-reply-playbooks";
