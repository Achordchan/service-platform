export type ResendDnsRecordView = {
  record: string;
  name: string;
  type: string;
  ttl: string;
  status: string;
  value: string;
  priority?: number;
};

export type PlatformSettingsView = {
  appUrl: string;
  mailMode: "LOCAL_OUTBOX" | "RESEND" | "SMTP";
  mailFrom: string;
  mailReplyTo: string;
  hasDedicatedEncryptionKey: boolean;
  hasResendApiKey: boolean;
  resendDomain: string;
  resendDomainId: string | null;
  resendDomainStatus: string | null;
  resendDnsRecords: ResendDnsRecordView[];
  resendWebhookId: string | null;
  resendWebhookStatus: string | null;
  hasResendWebhookSecret: boolean;
  resendLastCheckedAt: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpFrom: string;
  smtpSecure: boolean;
  hasStoredPassword: boolean;
  attachmentMaxSizeMb: number;
  attachmentAllowedExtensions: string;
  customerReplyAttachmentsEnabled: boolean;
  updatedAt?: string;
};

export type MailMessageView = {
  id: string;
  toEmail: string;
  subject: string;
  heading: string;
  body: string;
  actionLabel: string | null;
  actionUrl: string | null;
  deliveryMode: "LOCAL_OUTBOX" | "RESEND" | "SMTP";
  status:
    | "QUEUED"
    | "SENT"
    | "DELIVERY_DELAYED"
    | "DELIVERED"
    | "BOUNCED"
    | "COMPLAINED"
    | "SUPPRESSED"
    | "FAILED";
  errorMessage: string | null;
  providerId: string | null;
  sentAt: string | null;
  lastEventAt: string | null;
  createdAt: string;
};
