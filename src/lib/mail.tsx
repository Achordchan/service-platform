import { render } from "@react-email/render";
import nodemailer from "nodemailer";
import React from "react";
import { Resend } from "resend";
import type { MailDeliveryMode } from "@/generated/prisma/client";
import { decryptSecret } from "@/lib/secret-crypto";
import { withSystemDb } from "@/lib/system-db";
import {
  getRuntimeMailSettings,
  type RuntimeMailSettings,
} from "@/modules/platform-settings/mail-settings-runtime";
import { reconcileStoredResendEvents } from "@/modules/platform-settings/resend-webhook-service";

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

const SUPPORT_ADDRESS = "support@achord.cn";

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
  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          padding: "24px 12px",
          background: "#f5f7fa",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          color: "#1d1d1f",
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
            maxWidth: 560,
            margin: "0 auto",
            boxSizing: "border-box",
            background: "#ffffff",
            border: "1px solid #e5e7eb",
            borderRadius: 14,
            padding: "32px 28px",
          }}
        >
          <div
            style={{
              marginBottom: 24,
              color: "#1677ff",
              fontSize: 16,
              fontWeight: 700,
            }}
          >
            服务支持中心
          </div>
          <h1 style={{ margin: "0 0 16px", fontSize: 24, lineHeight: 1.35 }}>
            {heading}
          </h1>
          <p
            style={{
              margin: 0,
              color: "#5f6672",
              lineHeight: 1.75,
              whiteSpace: "pre-line",
            }}
          >
            {body}
          </p>
          {actionLabel && actionUrl ? (
            <>
              <a
                href={actionUrl}
                style={{
                  display: "inline-block",
                  marginTop: 24,
                  padding: "11px 18px",
                  borderRadius: 9,
                  background: "#1677ff",
                  color: "#ffffff",
                  textDecoration: "none",
                  fontWeight: 600,
                }}
              >
                {actionLabel}
              </a>
              <p
                style={{
                  margin: "20px 0 0",
                  color: "#8a919e",
                  fontSize: 12,
                  lineHeight: 1.6,
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
              marginTop: 32,
              paddingTop: 20,
              borderTop: "1px solid #edf0f3",
              color: "#8a919e",
              fontSize: 12,
              lineHeight: 1.7,
            }}
          >
            此邮件由系统自动发送。如需帮助，请回复此邮件或联系{" "}
            {SUPPORT_ADDRESS}。
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
  lines.push("", `如需帮助，请回复此邮件或联系 ${SUPPORT_ADDRESS}。`);
  return lines.join("\n");
}

async function deliverViaSmtp(
  payload: StoredMailPayload,
  settings: RuntimeMailSettings,
  html: string,
  text: string,
) {
  if (!settings.smtpHost || !settings.smtpPort) {
    throw new Error("SMTP 未配置完整：缺少主机或端口");
  }

  const transporter = nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpSecure,
    auth:
      settings.smtpUser && settings.smtpPassword
        ? {
            user: settings.smtpUser,
            pass: settings.smtpPassword,
          }
        : undefined,
  });

  const result = await transporter.sendMail({
    from: settings.smtpFrom,
    to: payload.toEmail,
    replyTo: settings.mailReplyTo,
    subject: payload.subject,
    html,
    text,
  });

  return {
    providerId:
      typeof result.messageId === "string" ? result.messageId : undefined,
  };
}

async function deliverViaResend(
  payload: StoredMailPayload,
  settings: RuntimeMailSettings,
  html: string,
  text: string,
) {
  if (!settings.resendApiKeyEncrypted) {
    throw new Error("Resend 未配置：缺少 API Key");
  }
  if (settings.resendDomainStatus !== "verified") {
    throw new Error("Resend 发信域名尚未验证");
  }

  const resend = new Resend(
    decryptSecret(settings.resendApiKeyEncrypted),
  );
  const result = await resend.emails.send(
    {
      from: settings.mailFrom,
      to: payload.toEmail,
      replyTo: settings.mailReplyTo,
      subject: payload.subject,
      html,
      text,
    },
    { idempotencyKey: `mail-${payload.id}` },
  );
  if (result.error || !result.data) {
    throw new Error(result.error?.message || "Resend 邮件发送失败");
  }
  return { providerId: result.data.id };
}

export async function processMailMessage(
  mailMessageId: string,
  options: { finalAttempt: boolean },
) {
  const message = await withSystemDb((tx) =>
    tx.mailMessage.findUnique({ where: { id: mailMessageId } }),
  );
  if (!message) {
    throw new Error("邮件队列记录不存在");
  }
  if (message.status !== "QUEUED") {
    return { id: message.id, skipped: true };
  }

  const attemptAt = new Date();
  await withSystemDb((tx) =>
    tx.mailMessage.update({
      where: { id: message.id },
      data: {
        attemptCount: { increment: 1 },
        lastAttemptAt: attemptAt,
        errorMessage: null,
      },
    }),
  );

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
    if (payload.deliveryMode === "RESEND" && delivery.providerId) {
      try {
        await reconcileStoredResendEvents(delivery.providerId, message.id);
      } catch (error) {
        console.error(
          "Resend 历史事件补偿失败：",
          error instanceof Error ? error.message : error,
        );
      }
    }
    return { id: message.id, mode: payload.deliveryMode };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "邮件发送失败";
    await withSystemDb((tx) =>
      tx.mailMessage.update({
        where: { id: message.id },
        data: {
          status: options.finalAttempt ? "FAILED" : "QUEUED",
          errorMessage,
        },
      }),
    );
    throw error;
  }
}
