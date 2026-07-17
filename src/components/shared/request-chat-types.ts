export type ChatAttachment = {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  visibility?: "CUSTOMER_VISIBLE" | "INTERNAL";
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
  }>;
};

export type ChatMessage = {
  id: string;
  body: string;
  authorId: string;
  authorName: string;
  authorImage?: string | null;
  authorPlatformRole?: string | null;
  authorSource?: "ACHORD" | "SUB2API" | "SYSTEM";
  createdAt: string;
  visibility?: "CUSTOMER_VISIBLE" | "INTERNAL";
  isSystem?: boolean;
  isInitial?: boolean;
  replyToMessageId?: string | null;
  replyTo?: ChatReplyReference | null;
  attachments: ChatAttachment[];
};

export type ChatReplyTarget = Pick<
  ChatMessage,
  "id" | "body" | "authorName" | "visibility" | "attachments"
>;
