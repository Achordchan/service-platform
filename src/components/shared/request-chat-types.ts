export type ChatAttachment = {
  id: string;
  originalName: string;
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
  authorId: string;
  authorName: string;
  visibility?: "CUSTOMER_VISIBLE" | "INTERNAL";
  attachments: Array<{
    id: string;
    originalName: string;
    inline?: boolean;
  }>;
};

export type ChatMessage = {
  id: string;
  body: string;
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
  "id" | "body" | "authorName" | "visibility" | "attachments"
>;

export type ChatReeditDraft = {
  version: number;
  requestId: string;
  messageId: string;
  body: string;
  attachmentCount: number;
};
import type { SupportReplyPlaybook } from "@/lib/support-reply-playbooks";
