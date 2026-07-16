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
  templateKey: string | null;
  subject: string;
  previewText: string | null;
  heading: string;
  body: string;
  actionLabel: string | null;
  actionUrl: string | null;
  deliveryMode: "LOCAL_OUTBOX" | "RESEND" | "SMTP";
  status:
    | "QUEUED"
    | "PROCESSING"
    | "SENT"
    | "DELIVERY_DELAYED"
    | "DELIVERED"
    | "BOUNCED"
    | "COMPLAINED"
    | "SUPPRESSED"
    | "FAILED"
    | "CANCELLED";
  errorMessage: string | null;
  attemptCount: number;
  lastAttemptAt: string | null;
  providerId: string | null;
  sentAt: string | null;
  lastEventAt: string | null;
  createdAt: string;
};

export type MailTemplateView = {
  key:
    | "PASSWORD_RESET"
    | "STAFF_INVITATION"
    | "CUSTOMER_OWNER_INVITATION"
    | "CUSTOMER_MEMBER_INVITATION"
    | "CUSTOMER_EMAIL_CHANGE_VERIFY"
    | "CUSTOMER_EMAIL_CHANGE_COMPLETED"
    | "CUSTOMER_EMAIL_CHANGE_SECURITY_NOTICE"
    | "TEST_EMAIL";
  name: string;
  description: string;
  variables: Array<{
    key: string;
    label: string;
    sample: string;
  }>;
  content: {
    subject: string;
    previewText: string;
    heading: string;
    body: string;
    actionLabel: string | null;
  };
  preview: {
    subject: string;
    previewText: string;
    heading: string;
    body: string;
    actionLabel: string | null;
  };
  customized: boolean;
  updatedAt: string | null;
};
