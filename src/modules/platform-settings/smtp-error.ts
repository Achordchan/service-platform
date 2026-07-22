export function describeSmtpError(error: unknown) {
  const code = smtpErrorCode(error);
  if (code === "EAUTH") {
    return "SMTP 身份验证失败，请检查用户名和授权码或应用专用密码";
  }
  if (
    code === "ETIMEDOUT" ||
    code === "ESOCKET" ||
    code === "ECONNECTION" ||
    code === "ECONNREFUSED"
  ) {
    return "无法连接 SMTP 服务器，请检查主机、端口、防火墙和加密方式";
  }
  if (code.startsWith("ECERT") || code === "ETLS") {
    return "SMTP TLS 证书或加密协商失败，请检查服务器证书和连接方式";
  }
  if (code === "EENVELOPE") {
    return "SMTP 拒绝了发件人或收件人地址，请检查发信身份和目标邮箱";
  }
  if (code === "EMESSAGE") {
    return "SMTP 服务器拒绝了邮件内容，请检查发件人策略和邮件大小限制";
  }
  return "SMTP 连接检测失败，请检查服务商设置和授权状态";
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

function smtpErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "";
}
