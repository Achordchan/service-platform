import type { MailDeliveryMode } from "@/generated/prisma/client";
import {
  describeSmtpError,
  smtpErrorCode,
} from "@/modules/platform-settings/smtp-error";

export type MailDeliveryFailure = {
  category:
    | "LOCAL_OUTBOX"
    | "MAIL_QUEUE"
    | "MAIL_RENDERING"
    | "RESEND_DELIVERY"
    | "SMTP_CONFIGURATION"
    | "SMTP_DELIVERY";
  code?: string;
  message: string;
};

export class MailDeliveryError extends Error {
  constructor(public readonly failure: MailDeliveryFailure) {
    super(failure.message);
    this.name = "MailDeliveryError";
  }
}

export function describeMailDeliveryFailure(
  deliveryMode: MailDeliveryMode,
  error: unknown,
): MailDeliveryFailure {
  if (error instanceof MailDeliveryError) return error.failure;

  if (deliveryMode === "SMTP") {
    const code = smtpErrorCode(error) || undefined;
    return {
      category: "SMTP_DELIVERY",
      ...(code ? { code } : {}),
      message: describeSmtpError(error),
    };
  }

  if (deliveryMode === "RESEND") {
    const code = safeProviderCode(error);
    return {
      category: "RESEND_DELIVERY",
      ...(code ? { code } : {}),
      message: code
        ? `Resend 投递失败，请检查发信域名、发件人和 API 配置（错误代码：${code}）`
        : "Resend 投递失败，请检查发信域名、发件人和 API 配置",
    };
  }

  return {
    category: "LOCAL_OUTBOX",
    message: "邮件创建时未启用真实发信通道，未实际发送",
  };
}

export function describeMailQueueFailure(error: unknown): MailDeliveryFailure {
  if (error instanceof MailDeliveryError) return error.failure;

  const code = safeProviderCode(error);
  const normalizedCode = code?.toUpperCase();
  const withCode = (message: string) =>
    code ? `${message}（错误代码：${code}）` : message;

  if (
    normalizedCode === "ECONNREFUSED" ||
    normalizedCode === "ECONNRESET" ||
    normalizedCode === "ETIMEDOUT" ||
    normalizedCode === "EHOSTUNREACH" ||
    normalizedCode === "ENOTFOUND" ||
    normalizedCode === "EAI_AGAIN"
  ) {
    return {
      category: "MAIL_QUEUE",
      ...(code ? { code } : {}),
      message: withCode(
        "无法连接邮件任务队列，请检查任务数据库和 Worker 运行状态",
      ),
    };
  }

  if (
    normalizedCode === "P1001" ||
    normalizedCode === "P1002" ||
    normalizedCode === "P1017" ||
    normalizedCode === "57P01" ||
    normalizedCode === "57P02" ||
    normalizedCode === "57P03" ||
    normalizedCode === "08000" ||
    normalizedCode === "08001" ||
    normalizedCode === "08003" ||
    normalizedCode === "08004" ||
    normalizedCode === "08006" ||
    normalizedCode === "08007"
  ) {
    return {
      category: "MAIL_QUEUE",
      ...(code ? { code } : {}),
      message: withCode("邮件任务数据库暂时不可用，请检查数据库连接和服务状态"),
    };
  }

  return {
    category: "MAIL_QUEUE",
    ...(code ? { code } : {}),
    message: withCode("邮件任务暂时无法加入队列，请检查 Worker 和任务数据库状态"),
  };
}

export function mailFailureReferenceId(mailMessageId: string) {
  return `mail_${mailMessageId}`;
}

export function formatMailFailureMessage(message: string, referenceId: string) {
  return `${message}。错误编号：${referenceId}`;
}

function safeProviderCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = String(error.code).trim();
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(code) ? code : undefined;
}
