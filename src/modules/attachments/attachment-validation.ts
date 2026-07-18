import { fileTypeFromBuffer } from "file-type";
import { badRequest, payloadTooLarge } from "@/modules/requests/errors";
import { getRuntimeAttachmentPolicy } from "@/modules/platform-settings/platform-setting-service";

export const DEFAULT_MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024;

const mimeByExtension = new Map([
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["pdf", "application/pdf"],
  [
    "docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  [
    "xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
  [
    "pptx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
  ["txt", "text/plain"],
  ["log", "text/plain"],
  ["csv", "text/csv"],
  ["json", "application/json"],
]);

const extensionByMime = new Map(
  Array.from(mimeByExtension.entries()).map(([ext, mime]) => [mime, ext]),
);

export type ValidatedAttachment = {
  mimeType: string;
  extension: string;
};

export type AttachmentPolicy = {
  maxSizeMb: number;
  allowedExtensions: string[];
  customerReplyAttachmentsEnabled: boolean;
};

export async function getAttachmentPolicy(): Promise<AttachmentPolicy> {
  return getRuntimeAttachmentPolicy();
}

export async function validateAttachmentFile(
  buffer: Uint8Array,
  claimedMimeType?: string,
  fileName?: string,
  policyInput?: AttachmentPolicy,
): Promise<ValidatedAttachment> {
  const policy = policyInput ?? (await getAttachmentPolicy());
  const maxBytes = Math.max(1, policy.maxSizeMb) * 1024 * 1024;
  const allowedExtensions = new Set(
    policy.allowedExtensions.map((item) => item.toLowerCase()),
  );

  if (buffer.byteLength === 0) {
    throw badRequest("EMPTY_ATTACHMENT", "附件不能为空");
  }
  if (buffer.byteLength > maxBytes) {
    throw payloadTooLarge(
      "ATTACHMENT_TOO_LARGE",
      `附件大小不能超过 ${policy.maxSizeMb}MB`,
    );
  }

  const fileExtension = fileName?.split(".").pop()?.toLowerCase() ?? "";
  let detected: Awaited<ReturnType<typeof fileTypeFromBuffer>>;
  try {
    detected = await fileTypeFromBuffer(buffer);
  } catch {
    detected = undefined;
  }

  if (!detected) {
    const textType = validateTextFile(
      buffer,
      claimedMimeType,
      fileName,
      allowedExtensions,
    );
    if (textType) return textType;
    throw badRequest(
      "UNKNOWN_ATTACHMENT_SIGNATURE",
      "无法识别附件的真实文件类型",
    );
  }

  const extension =
    extensionByMime.get(detected.mime) ||
    (fileExtension && mimeByExtension.get(fileExtension) === detected.mime
      ? fileExtension
      : null);
  if (!extension || !allowedExtensions.has(extension)) {
    throw badRequest(
      "ATTACHMENT_TYPE_NOT_ALLOWED",
      `仅支持：${Array.from(allowedExtensions).join("、")}`,
    );
  }

  const normalizedClaim = claimedMimeType?.toLowerCase().trim();
  if (
    normalizedClaim &&
    normalizedClaim !== "application/octet-stream" &&
    normalizedClaim !== detected.mime
  ) {
    throw badRequest(
      "ATTACHMENT_MIME_MISMATCH",
      "附件声明类型与文件签名不一致",
    );
  }

  return { mimeType: detected.mime, extension };
}

function validateTextFile(
  buffer: Uint8Array,
  claimedMimeType: string | undefined,
  fileName: string | undefined,
  allowedExtensions: Set<string>,
): ValidatedAttachment | null {
  const extension = fileName?.split(".").pop()?.toLowerCase() ?? "";
  if (!allowedExtensions.has(extension)) return null;
  const mimeType = mimeByExtension.get(extension);
  if (!mimeType || !mimeType.startsWith("text/") && mimeType !== "application/json") {
    // only pure text-like without binary signature
    if (!["txt", "log", "csv", "json"].includes(extension)) return null;
  }
  if (!mimeType) return null;

  const normalizedClaim = claimedMimeType?.toLowerCase().trim();
  if (
    normalizedClaim &&
    normalizedClaim !== "application/octet-stream" &&
    normalizedClaim !== mimeType &&
    !(extension === "log" && normalizedClaim === "text/plain")
  ) {
    return null;
  }
  if (buffer.includes(0)) return null;

  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
  return { mimeType, extension };
}

export function buildAcceptAttribute(extensions: string[]) {
  return extensions
    .map((item) => (item.startsWith(".") ? item : `.${item}`))
    .join(",");
}
