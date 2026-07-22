const DEFAULT_SMTP_SENDER_NAME = "服务支持中心";

export function smtpSenderName(value: string) {
  const bracketIndex = value.lastIndexOf("<");
  const name = (bracketIndex >= 0 ? value.slice(0, bracketIndex) : "")
    .replace(/[\r\n<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return name || DEFAULT_SMTP_SENDER_NAME;
}

export function formatSmtpSender(name: string, smtpUser: string) {
  const safeName = name
    .replace(/[\r\n<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const mailbox = smtpUser.trim();
  return safeName ? `${safeName} <${mailbox}>` : mailbox;
}

export function mailboxFromSender(value: string | null | undefined) {
  if (!value) return null;
  const bracketed = value.match(/<\s*([^<>]+)\s*>/);
  const normalized = (bracketed?.[1] ?? value).trim().toLowerCase();
  return /^[^\s@<>]+@[^\s@<>]+$/.test(normalized) ? normalized : null;
}
