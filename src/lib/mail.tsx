import { render } from "@react-email/render";
import React from "react";
import { Resend } from "resend";
import type { MailDeliveryMode } from "@/generated/prisma/client";
import { decryptSecret } from "@/lib/secret-crypto";
import {
  MAIL_PROCESSING_CLAIM_STALE_MS,
  mailAttemptBudgetWhere,
  maxMailAttempts,
} from "@/lib/mail-outbox-policy";
import { withSystemDb } from "@/lib/system-db";
import { hashInvitationToken } from "@/modules/invitations/invitation-token";
import {
  canSendStandardRequestEmailForModule,
  isCurrentMailRecipient,
  isStandardRequestRecipientRelevant,
} from "@/modules/notifications/standard-request-mail-policy";
import {
  isNotificationEmailRuleEnabled,
  STANDARD_NOTIFICATION_EMAIL_RULE_KEYS,
  type NotificationDeliveryRuleState,
} from "@/modules/notifications/notification-delivery-rules";
import {
  canSendStandardProjectEmailForModule,
  isStandardProjectRecipientRelevant,
} from "@/modules/notifications/standard-project-mail-policy";
import {
  getRuntimeMailSettings,
  type RuntimeMailSettings,
} from "@/modules/platform-settings/mail-settings-runtime";
import { reconcileStoredResendEvents } from "@/modules/platform-settings/resend-webhook-service";
import {
  isSmtpProviderFailure,
  smtpSenderPolicyError,
} from "@/modules/platform-settings/smtp-error";
import {
  describeMailDeliveryFailure,
  formatMailFailureMessage,
  mailFailureReferenceId,
  MailDeliveryError,
} from "@/modules/platform-settings/mail-delivery-error";
import { createSmtpTransport } from "@/modules/platform-settings/smtp-transport";

type StoredMailPayload = {
  id: string;
  toEmail: string;
  subject: string;
  previewText: string | null;
  heading: string;
  body: string;
  actionLabel: string | null;
  actionUrl: string | null;
  deliveryMode: MailDeliveryMode;
};

function MailDocument({
  previewText,
  heading,
  body,
  actionLabel,
  actionUrl,
}: Omit<
  StoredMailPayload,
  "id" | "toEmail" | "subject" | "deliveryMode"
>) {
  const bodyParagraphs = body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          padding: "32px 12px",
          background: "#f3f5f7",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          color: "#111827",
          fontSize: 16,
          lineHeight: 1.8,
        }}
      >
        {previewText ? (
          <div
            style={{
              display: "none",
              maxHeight: 0,
              overflow: "hidden",
              opacity: 0,
            }}
          >
            {previewText}
          </div>
        ) : null}
        <div
          style={{
            width: "100%",
            maxWidth: 600,
            margin: "0 auto",
            boxSizing: "border-box",
            background: "#ffffff",
            border: "1px solid #e2e7ee",
            borderRadius: 12,
            padding: "38px 36px 32px",
          }}
        >
          <div
            style={{
              marginBottom: 28,
              paddingBottom: 18,
              borderBottom: "1px solid #edf0f4",
              color: "#155eef",
              fontSize: 15,
              fontWeight: 700,
              lineHeight: 1.4,
            }}
          >
            服务支持中心
          </div>
          <h1
            style={{
              margin: "0 0 18px",
              color: "#111827",
              fontSize: 26,
              fontWeight: 700,
              lineHeight: 1.4,
            }}
          >
            {heading}
          </h1>
          <div>
            {bodyParagraphs.map((paragraph, index) => (
              <p
                key={`${index}:${paragraph.slice(0, 24)}`}
                style={{
                  margin: index === 0 ? 0 : "18px 0 0",
                  color: "#374151",
                  fontSize: 16,
                  lineHeight: 1.8,
                  whiteSpace: "pre-line",
                  overflowWrap: "anywhere",
                }}
              >
                {paragraph}
              </p>
            ))}
          </div>
          {actionLabel && actionUrl ? (
            <>
              <a
                href={actionUrl}
                style={{
                  display: "inline-block",
                  marginTop: 28,
                  padding: "13px 22px",
                  borderRadius: 7,
                  background: "#155eef",
                  color: "#ffffff",
                  fontSize: 15,
                  lineHeight: 1.4,
                  textDecoration: "none",
                  fontWeight: 600,
                }}
              >
                {actionLabel}
              </a>
              <p
                style={{
                  margin: "22px 0 0",
                  color: "#77808f",
                  fontSize: 12.5,
                  lineHeight: 1.7,
                  wordBreak: "break-all",
                }}
              >
                按钮无法打开时，请复制此链接到浏览器：
                <br />
                {actionUrl}
              </p>
            </>
          ) : null}
          <div
            style={{
              marginTop: 36,
              paddingTop: 22,
              borderTop: "1px solid #edf0f3",
              color: "#77808f",
              fontSize: 13,
              lineHeight: 1.7,
            }}
          >
            此邮件由系统自动发送。如需帮助，请直接回复此邮件。
          </div>
        </div>
      </body>
    </html>
  );
}

async function renderMailHtml(payload: StoredMailPayload) {
  return render(
    <MailDocument
      previewText={payload.previewText}
      heading={payload.heading}
      body={payload.body}
      actionLabel={payload.actionLabel}
      actionUrl={payload.actionUrl}
    />,
  );
}

function renderMailText(payload: StoredMailPayload) {
  const lines = [payload.heading, "", payload.body];
  if (payload.actionLabel && payload.actionUrl) {
    lines.push("", `${payload.actionLabel}：${payload.actionUrl}`);
  }
  lines.push("", "如需帮助，请直接回复此邮件。");
  return lines.join("\n");
}

async function deliverViaSmtp(
  payload: StoredMailPayload,
  settings: RuntimeMailSettings,
  html: string,
  text: string,
) {
  if (!settings.smtpHost || !settings.smtpPort) {
    throw new MailDeliveryError({
      category: "SMTP_CONFIGURATION",
      message: "SMTP 未配置完整：缺少主机或端口",
    });
  }

  if (!settings.smtpUser || !settings.smtpPassword) {
    throw new MailDeliveryError({
      category: "SMTP_CONFIGURATION",
      message: "SMTP 未配置完整：缺少用户名或密码",
    });
  }
  const senderPolicyError = smtpSenderPolicyError({
    smtpHost: settings.smtpHost,
    smtpUser: settings.smtpUser,
    smtpFrom: settings.smtpFrom,
  });
  if (senderPolicyError) {
    await withSystemDb((tx) =>
      tx.platformSetting.update({
        where: { id: 1 },
        data: {
          smtpHealthStatus: "error",
          smtpLastCheckedAt: new Date(),
          smtpLastError: senderPolicyError,
        },
      }),
    );
    throw new MailDeliveryError({
      category: "SMTP_CONFIGURATION",
      code: "ESENDER",
      message: senderPolicyError,
    });
  }
  const transporter = createSmtpTransport({
    smtpHost: settings.smtpHost,
    smtpPort: settings.smtpPort,
    smtpUser: settings.smtpUser,
    smtpPassword: settings.smtpPassword,
    smtpSecure: settings.smtpSecure,
  });
  try {
    const result = await transporter.sendMail({
      from: settings.smtpFrom,
      to: payload.toEmail,
      subject: payload.subject,
      html,
      text,
    });

    return {
      providerId:
        typeof result.messageId === "string" ? result.messageId : undefined,
    };
  } catch (error) {
    const failure = describeMailDeliveryFailure("SMTP", error);
    if (isSmtpProviderFailure(error)) {
      await withSystemDb((tx) =>
        tx.platformSetting.update({
          where: { id: 1 },
          data: {
            smtpHealthStatus: "error",
            smtpLastCheckedAt: new Date(),
            smtpLastError: failure.message,
          },
        }),
      );
    }
    throw new MailDeliveryError(failure);
  } finally {
    transporter.close();
  }
}

async function deliverViaResend(
  payload: StoredMailPayload,
  settings: RuntimeMailSettings,
  html: string,
  text: string,
) {
  if (!settings.resendApiKeyEncrypted) {
    throw new MailDeliveryError({
      category: "RESEND_DELIVERY",
      message: "Resend 未配置：缺少 API Key",
    });
  }
  if (settings.resendDomainStatus !== "verified") {
    throw new MailDeliveryError({
      category: "RESEND_DELIVERY",
      message: "Resend 发信域名尚未验证",
    });
  }

  const resend = new Resend(
    decryptSecret(settings.resendApiKeyEncrypted),
  );
  const result = await resend.emails.send(
    {
      from: settings.mailFrom,
      to: payload.toEmail,
      subject: payload.subject,
      html,
      text,
    },
    { idempotencyKey: `mail-${payload.id}` },
  );
  if (result.error || !result.data) {
    throw new MailDeliveryError(
      describeMailDeliveryFailure("RESEND", result.error),
    );
  }
  return { providerId: result.data.id };
}

export async function processMailMessage(
  mailMessageId: string,
  options: {
    finalAttempt: boolean;
    expectedDeliveryMode?: MailDeliveryMode;
  },
) {
  const attemptAt = new Date();
  const staleClaimBefore = new Date(
    attemptAt.getTime() - MAIL_PROCESSING_CLAIM_STALE_MS,
  );
  const claim = await withSystemDb(async (tx) => {
    const claimed = await tx.mailMessage.updateMany({
      where: {
        id: mailMessageId,
        ...(options.expectedDeliveryMode
          ? { deliveryMode: options.expectedDeliveryMode }
          : {}),
        contentRiskReviewId: null,
        AND: [
          mailAttemptBudgetWhere(),
          {
            OR: [
              { status: "QUEUED" },
              {
                status: "PROCESSING",
                lastAttemptAt: { lt: staleClaimBefore },
              },
            ],
          },
        ],
      },
      data: {
        status: "PROCESSING",
        attemptCount: { increment: 1 },
        lastAttemptAt: attemptAt,
        errorMessage: null,
      },
    });
    const message = await tx.mailMessage.findUnique({
      where: { id: mailMessageId },
    });
    return { claimed: claimed.count > 0, message };
  });
  const message = claim.message;
  if (!message) {
    throw new Error("邮件队列记录不存在");
  }
  if (!claim.claimed) {
    if (
      message.status === "QUEUED" &&
      message.attemptCount >= maxMailAttempts(message.deliveryMode)
    ) {
      await withSystemDb((tx) =>
        tx.mailMessage.updateMany({
          where: { id: message.id, status: "QUEUED" },
          data: {
            status: "FAILED",
            errorMessage: "邮件发送已达到重试上限",
          },
        }),
      );
    }
    return { id: message.id, skipped: true };
  }
  if (
    (message.sourceType === "STANDARD_REQUEST_NOTIFICATION" ||
      message.sourceType === "STANDARD_PROJECT_NOTIFICATION") &&
    !(await notificationMailStillSendable(message))
  ) {
    await cancelMailBeforeDelivery(
      message.id,
      "通知已读、已更新或邮件提醒已关闭",
    );
    return { id: message.id, cancelled: true };
  }
  if (
    isAccountActionMail(message.sourceType) &&
    !(await accountActionMailStillSendable(message))
  ) {
    await cancelMailBeforeDelivery(
      message.id,
      "邀请或验证链接已失效、已使用或已被替换",
    );
    return { id: message.id, cancelled: true };
  }

  const payload: StoredMailPayload = {
    id: message.id,
    toEmail: message.toEmail,
    subject: message.subject,
    previewText: message.previewText,
    heading: message.heading,
    body: message.body,
    actionLabel: message.actionLabel,
    actionUrl: message.actionUrl,
    deliveryMode: message.deliveryMode,
  };

  try {
    if (payload.deliveryMode === "LOCAL_OUTBOX") {
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          "邮件创建时未启用真实发信通道，未实际发送",
        );
      }
      await withSystemDb((tx) =>
        tx.mailMessage.update({
          where: { id: message.id },
          data: {
            status: "SENT",
            providerId: "local-outbox",
            sentAt: attemptAt,
            lastEventAt: attemptAt,
            errorMessage: null,
          },
        }),
      );
      await markNotificationMailSent(message);
      return { id: message.id, mode: "LOCAL_OUTBOX" as const };
    }

    const settings = await getRuntimeMailSettings();
    const html = await renderMailHtml(payload);
    const text = renderMailText(payload);
    const delivery =
      payload.deliveryMode === "RESEND"
        ? await deliverViaResend(payload, settings, html, text)
        : await deliverViaSmtp(payload, settings, html, text);
    const sentAt = new Date();
    await withSystemDb((tx) =>
      tx.mailMessage.update({
        where: { id: message.id },
        data: {
          status: "SENT",
          providerId: delivery.providerId,
          sentAt,
          lastEventAt:
            payload.deliveryMode === "RESEND" ? null : sentAt,
          errorMessage: null,
        },
      }),
    );
    await markNotificationMailSent(message);
    if (payload.deliveryMode === "RESEND" && delivery.providerId) {
      try {
        await reconcileStoredResendEvents(delivery.providerId, message.id);
      } catch (error) {
        console.error(
          "ACHORD_RESEND_EVENT_RECONCILIATION_FAILED",
          JSON.stringify({
            event: "mail.resend_event_reconciliation_failed",
            mailMessageId: message.id,
            providerId: delivery.providerId,
            error: describeMailDeliveryFailure("RESEND", error),
          }),
        );
      }
    }
    return { id: message.id, mode: payload.deliveryMode };
  } catch (error) {
    const failure = describeMailDeliveryFailure(message.deliveryMode, error);
    const referenceId = mailFailureReferenceId(message.id);
    const errorMessage = formatMailFailureMessage(failure.message, referenceId);
    const attemptsExhausted =
      message.attemptCount >= maxMailAttempts(message.deliveryMode);
    console.error(
      "ACHORD_MAIL_DELIVERY_FAILED",
      JSON.stringify({
        event: "mail.delivery_failed",
        referenceId,
        mailMessageId: message.id,
        deliveryMode: message.deliveryMode,
        templateKey: message.templateKey,
        sourceType: message.sourceType,
        attempt: message.attemptCount,
        finalAttempt: options.finalAttempt,
        error: failure,
      }),
    );
    await withSystemDb((tx) =>
      tx.mailMessage.update({
        where: { id: message.id },
        data: {
          status:
            options.finalAttempt || attemptsExhausted ? "FAILED" : "QUEUED",
          errorMessage,
        },
      }),
    );
    throw new MailDeliveryError(failure);
  }
}

async function notificationMailStillSendable(message: {
  id: string;
  sourceType: string | null;
  toEmail: string;
  notificationId: string | null;
  notificationOccurrenceCount: number | null;
}) {
  if (!message.notificationId || !message.notificationOccurrenceCount) {
    return false;
  }
  return withSystemDb(async (tx) => {
    const settings = await tx.platformSetting.findUnique({
      where: { id: 1 },
      select: { mailMode: true },
    });
    const currentMessage = await tx.mailMessage.findUnique({
      where: { id: message.id },
      select: { status: true },
    });
    const notification = await tx.notification.findUnique({
      where: { id: message.notificationId! },
      select: {
        type: true,
        readAt: true,
        occurrenceCount: true,
        user: {
          select: {
            id: true,
            email: true,
            platformRole: true,
            requestEmailNotificationsEnabled: true,
          },
        },
        serviceRequest: {
          select: {
            archivedAt: true,
            assignees: { select: { userId: true } },
            project: {
              select: {
                kind: true,
                customerRequestsEnabled: true,
                customerSpace: {
                  select: {
                    memberships: { select: { userId: true } },
                  },
                },
                staff: { select: { userId: true } },
              },
            },
          },
        },
        project: {
          select: {
            kind: true,
            customerUpdatesEnabled: true,
            customerFilesEnabled: true,
            showMilestones: true,
            showProgress: true,
            customerSpace: {
              select: {
                memberships: { select: { userId: true } },
              },
            },
            staff: {
              where: { role: "PROJECT_MANAGER" },
              select: { userId: true },
            },
          },
        },
      },
    });
    const deliveryRules = await tx.notificationDeliveryRule.findMany({
      where: { key: { in: [...STANDARD_NOTIFICATION_EMAIL_RULE_KEYS] } },
      select: {
        key: true,
        notificationEnabled: true,
        soundEnabled: true,
        emailEnabled: true,
        dingtalkEnabled: true,
      },
    });
    const deliveryRuleByKey = new Map<string, NotificationDeliveryRuleState>(
      deliveryRules.map((rule) => [rule.key, rule]),
    );
    const commonValid = Boolean(
      Boolean(settings && settings.mailMode !== "LOCAL_OUTBOX") &&
        currentMessage?.status === "PROCESSING" &&
        notification &&
        isNotificationEmailRuleEnabled(
          notification.type,
          deliveryRuleByKey,
        ) &&
        notification.readAt === null &&
        notification.occurrenceCount === message.notificationOccurrenceCount &&
        isCurrentMailRecipient(message.toEmail, notification.user.email) &&
        notification.user.requestEmailNotificationsEnabled,
    );
    if (!commonValid || !notification) return false;
    if (message.sourceType === "STANDARD_REQUEST_NOTIFICATION") {
      return Boolean(
        notification.serviceRequest &&
        !notification.serviceRequest.archivedAt &&
        notification.serviceRequest.project.kind === "STANDARD" &&
        canSendStandardRequestEmailForModule({
          platformRole: notification.user.platformRole,
          customerRequestsEnabled:
            notification.serviceRequest.project.customerRequestsEnabled,
        }) &&
        isStandardRequestRecipientRelevant({
          userId: notification.user.id,
          platformRole: notification.user.platformRole,
          membershipUserIds:
            notification.serviceRequest.project.customerSpace.memberships.map(
              (item) => item.userId,
            ),
          projectStaffUserIds:
            notification.serviceRequest.project.staff.map(
              (item) => item.userId,
            ),
          assigneeUserIds: notification.serviceRequest.assignees.map(
            (item) => item.userId,
          ),
        }),
      );
    }
    if (message.sourceType !== "STANDARD_PROJECT_NOTIFICATION") return false;
    return Boolean(
      notification.project &&
        notification.project.kind === "STANDARD" &&
        isStandardProjectRecipientRelevant({
          userId: notification.user.id,
          platformRole: notification.user.platformRole,
          notificationType: notification.type,
          membershipUserIds:
            notification.project.customerSpace.memberships.map(
              (item) => item.userId,
            ),
          projectManagerUserIds: notification.project.staff.map(
            (item) => item.userId,
          ),
        }) &&
        canSendStandardProjectEmailForModule({
          notificationType: notification.type,
          customerUpdatesEnabled:
            notification.project.customerUpdatesEnabled,
          customerFilesEnabled: notification.project.customerFilesEnabled,
          showMilestones: notification.project.showMilestones,
          showProgress: notification.project.showProgress,
        }),
    );
  });
}

function isAccountActionMail(sourceType: string | null) {
  return (
    sourceType === "STAFF_INVITATION" ||
    sourceType === "CUSTOMER_OWNER_INVITATION" ||
    sourceType === "CUSTOMER_MEMBER_INVITATION" ||
    sourceType === "CUSTOMER_EMAIL_CHANGE_VERIFY"
  );
}

async function accountActionMailStillSendable(message: {
  sourceType: string | null;
  sourceId: string | null;
  toEmail: string;
  actionUrl: string | null;
}) {
  if (!message.sourceId || !message.actionUrl) return false;
  let tokenHash: string;
  try {
    const token = new URL(message.actionUrl).searchParams.get("token");
    if (!token) return false;
    tokenHash = hashInvitationToken(token);
  } catch {
    return false;
  }
  const now = new Date();
  const toEmail = message.toEmail.trim().toLowerCase();
  return withSystemDb(async (tx) => {
    if (message.sourceType === "STAFF_INVITATION") {
      const invitation = await tx.staffInvitation.findUnique({
        where: { id: message.sourceId! },
        select: {
          email: true,
          tokenHash: true,
          expiresAt: true,
          acceptedAt: true,
          revokedAt: true,
        },
      });
      return Boolean(
        invitation &&
          invitation.email.toLowerCase() === toEmail &&
          invitation.tokenHash === tokenHash &&
          invitation.expiresAt > now &&
          !invitation.acceptedAt &&
          !invitation.revokedAt,
      );
    }
    if (
      message.sourceType === "CUSTOMER_OWNER_INVITATION" ||
      message.sourceType === "CUSTOMER_MEMBER_INVITATION"
    ) {
      const invitation = await tx.invitation.findUnique({
        where: { id: message.sourceId! },
        select: {
          email: true,
          tokenHash: true,
          expiresAt: true,
          acceptedAt: true,
          revokedAt: true,
        },
      });
      return Boolean(
        invitation &&
          invitation.email.toLowerCase() === toEmail &&
          invitation.tokenHash === tokenHash &&
          invitation.expiresAt > now &&
          !invitation.acceptedAt &&
          !invitation.revokedAt,
      );
    }
    const change = await tx.userEmailChange.findUnique({
      where: { id: message.sourceId! },
      select: {
        newEmail: true,
        tokenHash: true,
        expiresAt: true,
        status: true,
      },
    });
    return Boolean(
      change &&
        change.newEmail.toLowerCase() === toEmail &&
        change.tokenHash === tokenHash &&
        change.expiresAt > now &&
        change.status === "PENDING",
    );
  });
}

function cancelMailBeforeDelivery(mailMessageId: string, reason: string) {
  return withSystemDb((tx) =>
    tx.mailMessage.update({
      where: { id: mailMessageId },
      data: {
        status: "CANCELLED",
        errorMessage: reason,
      },
    }),
  );
}

async function markNotificationMailSent(message: {
  notificationId: string | null;
  notificationOccurrenceCount: number | null;
}) {
  if (!message.notificationId || !message.notificationOccurrenceCount) return;
  await withSystemDb((tx) =>
    tx.notification.updateMany({
      where: {
        id: message.notificationId!,
        occurrenceCount: message.notificationOccurrenceCount!,
      },
      data: {
        emailLastSentOccurrenceCount: message.notificationOccurrenceCount!,
        emailClaimedAt: null,
      },
    }),
  );
}
