"use client";

import { useEffect, useMemo, useState } from "react";

export type AttachmentPolicy = {
  maxSizeMb: number;
  allowedExtensions: string[];
  customerReplyAttachmentsEnabled: boolean;
  accept: string;
};

const FALLBACK_EXTENSIONS = [
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "pdf",
  "docx",
  "xlsx",
  "pptx",
  "txt",
  "log",
  "csv",
  "json",
];

const FALLBACK_POLICY: AttachmentPolicy = {
  maxSizeMb: 20,
  allowedExtensions: FALLBACK_EXTENSIONS,
  customerReplyAttachmentsEnabled: true,
  accept: FALLBACK_EXTENSIONS.map((item) => `.${item}`).join(","),
};

function extensionOf(file: File) {
  const name = file.name || "";
  const parts = name.split(".");
  if (parts.length < 2) {
    if (file.type === "image/png") return "png";
    if (file.type === "image/jpeg") return "jpg";
    if (file.type === "image/gif") return "gif";
    if (file.type === "image/webp") return "webp";
    return "";
  }
  return parts.pop()!.toLowerCase();
}

export function useAttachmentPolicy() {
  const [policy, setPolicy] = useState<AttachmentPolicy | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void fetch("/api/v1/attachment-policy")
      .then(async (response) => {
        if (!response.ok) return null;
        const payload = (await response.json()) as { data: AttachmentPolicy };
        return payload.data;
      })
      .then((data) => {
        if (!active) return;
        if (data) setPolicy(data);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const resolved = policy ?? FALLBACK_POLICY;
  const allowed = useMemo(
    () => new Set(resolved.allowedExtensions.map((item) => item.toLowerCase())),
    [resolved.allowedExtensions],
  );

  function validateFiles(
    next: File[],
    currentCount = 0,
    maxCount = 5,
  ): { accepted: File[]; error: string } {
    const accepted: File[] = [];
    let error = "";
    for (const file of next) {
      if (currentCount + accepted.length >= maxCount) {
        error = `最多上传 ${maxCount} 个附件`;
        break;
      }
      const ext = extensionOf(file);
      if (allowed.size > 0 && (!ext || !allowed.has(ext))) {
        error = `不支持 .${ext || "未知"}，允许：${Array.from(allowed).join("、")}`;
        continue;
      }
      if (file.size > resolved.maxSizeMb * 1024 * 1024) {
        error = `单个附件不能超过 ${resolved.maxSizeMb}MB`;
        continue;
      }
      accepted.push(file);
    }
    return { accepted, error };
  }

  function filesFromClipboard(clipboardData: DataTransfer | null) {
    const items = Array.from(clipboardData?.items ?? []);
    return items
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item, index) => {
        const file = item.getAsFile();
        if (!file) return null;
        const ext =
          file.type === "image/png"
            ? "png"
            : file.type === "image/webp"
              ? "webp"
              : file.type === "image/gif"
                ? "gif"
                : "jpg";
        return new File(
          [file],
          file.name || `paste-${Date.now()}-${index}.${ext}`,
          { type: file.type },
        );
      })
      .filter((file): file is File => Boolean(file));
  }

  return {
    policy: resolved,
    loading,
    validateFiles,
    filesFromClipboard,
  };
}
