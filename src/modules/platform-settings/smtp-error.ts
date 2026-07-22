import { mailboxFromSender } from "@/modules/platform-settings/smtp-sender";

export function describeSmtpError(error: unknown) {
  const code = smtpErrorCode(error);
  const withCode = (message: string) =>
    code ? `${message}（错误代码：${code}）` : message;
  if (code === "EAUTH") {
    return withCode(
      "SMTP 身份验证失败，请检查用户名和授权码或应用专用密码",
    );
  }
  if (
    code === "ETIMEDOUT" ||
    code === "ESOCKET" ||
    code === "ECONNECTION" ||
    code === "ECONNREFUSED"
  ) {
    return withCode(
      "无法连接 SMTP 服务器，请检查主机、端口、防火墙和加密方式",
    );
  }
  if (code.startsWith("ECERT") || code === "ETLS") {
    return withCode(
      "SMTP TLS 证书或加密协商失败，请检查服务器证书和连接方式",
    );
  }
  if (code === "EENVELOPE") {
    const command = smtpErrorCommand(error);
    if (command === "MAIL FROM") {
      return withCode(
        "SMTP 拒绝了发件人地址，请确认发件邮箱属于当前 SMTP 账号或已被服务商授权",
      );
    }
    if (command === "RCPT TO") {
      return withCode(
        "SMTP 拒绝了收件人地址，请检查目标邮箱是否有效以及账号是否允许向外部地址发信",
      );
    }
    return withCode(
      "SMTP 拒绝了发件人或收件人地址，请检查发信身份和目标邮箱",
    );
  }
  if (code === "EMESSAGE") {
    return withCode(
      "SMTP 服务器拒绝了邮件内容，请检查发件人策略和邮件大小限制",
    );
  }
  return withCode("SMTP 连接检测失败，请检查服务商设置和授权状态");
}

export function smtpSenderPolicyError(input: {
  smtpHost: string;
  smtpUser: string;
  smtpFrom: string;
}) {
  if (input.smtpHost.trim().toLowerCase() !== "smtp.qq.com") return null;
  const smtpUser = normalizeMailbox(input.smtpUser);
  const smtpFrom = mailboxFromSender(input.smtpFrom);
  if (!smtpUser || !smtpFrom || smtpUser === smtpFrom) return null;
  return "QQ SMTP 要求发件邮箱与 SMTP 登录账号一致；可以保留显示名称，但尖括号内必须填写当前 QQ 邮箱";
}

export function isSmtpProviderFailure(error: unknown) {
  const code = smtpErrorCode(error);
  return (
    code === "EAUTH" ||
    code === "ETIMEDOUT" ||
    code === "ESOCKET" ||
    code === "ECONNECTION" ||
    code === "ECONNREFUSED" ||
    code === "ETLS" ||
    code.startsWith("ECERT")
  );
}

export function smtpErrorCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return "";
  }
  const code = String(error.code).trim().toUpperCase();
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : "";
}

function smtpErrorCommand(error: unknown) {
  if (typeof error !== "object" || error === null || !("command" in error)) {
    return "";
  }
  const command = String(error.command).trim().toUpperCase();
  return command === "MAIL FROM" || command === "RCPT TO" ? command : "";
}

function normalizeMailbox(value: string) {
  const normalized = value.trim().toLowerCase();
  return /^[^\s@<>]+@[^\s@<>]+$/.test(normalized) ? normalized : null;
}
