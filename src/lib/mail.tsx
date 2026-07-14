import { render } from "@react-email/render";
import nodemailer from "nodemailer";
import React from "react";
import { withSystemDb } from "@/lib/system-db";
import {
  getRuntimeMailSettings,
  type RuntimeMailSettings,
} from "@/modules/platform-settings/mail-settings-runtime";

export type MailPayload = {
  to: string;
  subject: string;
  heading: string;
  body: string;
  actionLabel?: string;
  actionUrl?: string;
};

function MailTemplate({
  heading,
  body,
  actionLabel,
  actionUrl,
}: Omit<MailPayload, "to" | "subject">) {
  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          background: "#f5f7fa",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          color: "#1d1d1f",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 560,
            margin: "32px auto",
            background: "#ffffff",
            border: "1px solid #e5e7eb",
            borderRadius: 14,
            padding: 32,
          }}
        >
          <h1 style={{ margin: "0 0 16px", fontSize: 24 }}>{heading}</h1>
          <p style={{ margin: 0, color: "#5f6672", lineHeight: 1.7 }}>{body}</p>
          {actionLabel && actionUrl ? (
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
          ) : null}
        </div>
      </body>
    </html>
  );
}

async function renderMailHtml(payload: MailPayload) {
  return render(
    <MailTemplate
      heading={payload.heading}
      body={payload.body}
      actionLabel={payload.actionLabel}
      actionUrl={payload.actionUrl}
    />,
  );
}

async function deliverViaSmtp(
  payload: MailPayload,
  settings: RuntimeMailSettings,
  html: string,
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
    to: payload.to,
    subject: payload.subject,
    html,
  });

  return {
    providerId:
      typeof result.messageId === "string" ? result.messageId : undefined,
  };
}

export async function sendMail(payload: MailPayload) {
  const settings = await getRuntimeMailSettings();
  const html = await renderMailHtml(payload);

  const message = await withSystemDb((tx) =>
    tx.mailMessage.create({
      data: {
        toEmail: payload.to,
        subject: payload.subject,
        heading: payload.heading,
        body: payload.body,
        actionLabel: payload.actionLabel,
        actionUrl: payload.actionUrl,
        status: "QUEUED",
      },
    }),
  );

  try {
    if (settings.mailMode === "LOCAL_OUTBOX") {
      await withSystemDb((tx) =>
        tx.mailMessage.update({
          where: { id: message.id },
          data: {
            status: "SENT",
            providerId: "local-outbox",
            sentAt: new Date(),
            errorMessage: null,
          },
        }),
      );
      return { id: message.id, mode: "LOCAL_OUTBOX" as const };
    }

    const delivery = await deliverViaSmtp(payload, settings, html);
    await withSystemDb((tx) =>
      tx.mailMessage.update({
        where: { id: message.id },
        data: {
          status: "SENT",
          providerId: delivery.providerId,
          sentAt: new Date(),
          errorMessage: null,
        },
      }),
    );
    return { id: message.id, mode: "SMTP" as const };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "邮件发送失败";
    await withSystemDb((tx) =>
      tx.mailMessage.update({
        where: { id: message.id },
        data: {
          status: "FAILED",
          errorMessage,
        },
      }),
    );
    throw error;
  }
}
