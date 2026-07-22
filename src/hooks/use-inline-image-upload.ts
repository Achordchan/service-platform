"use client";

import { useCallback } from "react";
import type { RichTextImageUploadResult } from "@/components/shared/rich-text-editor";

type InlineImageTarget =
  | {
      projectId: string;
      context: "REQUEST_DESCRIPTION" | "PROJECT_UPDATE" | "MILESTONE";
      visibility?: "CUSTOMER_VISIBLE" | "INTERNAL";
    }
  | {
      requestId: string;
      visibility?: "CUSTOMER_VISIBLE" | "INTERNAL";
    };

type UploadPayload = {
  data?: { id?: string };
  error?: { message?: string };
};

export function useInlineImageUpload(target: InlineImageTarget) {
  return useCallback(
    async (file: File): Promise<RichTextImageUploadResult> => {
      const form = new FormData();
      form.append("file", file);
      form.append("inline", "true");
      form.append("visibility", target.visibility ?? "CUSTOMER_VISIBLE");
      if ("projectId" in target) {
        form.append("projectId", target.projectId);
        form.append("inlineContext", target.context);
      } else {
        form.append("serviceRequestId", target.requestId);
      }

      const response = await fetch("/api/v1/attachments", {
        method: "POST",
        body: form,
      });
      const payload = (await response.json()) as UploadPayload;
      const attachmentId = payload.data?.id;
      if (!response.ok || !attachmentId) {
        throw new Error(payload.error?.message || "图片上传失败");
      }
      return { attachmentId };
    },
    [target],
  );
}
