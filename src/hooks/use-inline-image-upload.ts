"use client";

import { useCallback } from "react";
import type { RichTextImageUploadResult } from "@/components/shared/rich-text-editor";
import { apiRequest } from "@/lib/api-client";

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

      const result = await apiRequest<{ id: string }>(
        "/api/v1/attachments",
        { method: "POST", body: form },
        "图片上传失败",
      );
      return { attachmentId: result.id };
    },
    [target],
  );
}
