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
