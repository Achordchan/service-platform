"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Button,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import AttachFileOutlinedIcon from "@mui/icons-material/AttachFileOutlined";
import SendOutlinedIcon from "@mui/icons-material/SendOutlined";
import { RequestAttachmentDrafts } from "@/components/shared/request-chat-attachments";
import { RichTextEditor } from "@/components/shared/rich-text-editor";
import type { ChatReplyTarget } from "@/components/shared/request-chat-types";
import { RequestReplyPreview } from "@/components/shared/request-reply-preview";
import { useAttachmentPolicy } from "@/hooks/use-attachment-policy";
import { useInlineImageUpload } from "@/hooks/use-inline-image-upload";
import { markRequestLocalMutation } from "@/hooks/use-request-realtime";
import {
  buildAttachmentOnlyMessage,
  hasMeaningfulHtml,
} from "@/lib/message-content";

type ApiPayload = {
  data?: {
    message?: { id: string };
  };
  error?: {
    message?: string;
  };
};

export function RequestReplyForm({
  requestId,
  disabled = false,
  replyTarget,
  onCancelReply,
  onTypingActivity,
  onTypingStopped,
}: {
  requestId: string;
  disabled?: boolean;
  replyTarget?: ChatReplyTarget | null;
  onCancelReply?: () => void;
  onTypingActivity?: () => void;
  onTypingStopped?: () => void;
}) {
  const router = useRouter();
  const { policy, validateFiles } = useAttachmentPolicy();
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [inlineImageUploading, setInlineImageUploading] = useState(false);

  const attachmentsEnabled = policy.customerReplyAttachmentsEnabled !== false;
  const uploadInlineImage = useInlineImageUpload({ requestId });

  function addFiles(next: File[]) {
    const { accepted, error: validateError } = validateFiles(next, files.length);
    if (validateError) setError(validateError);
    if (accepted.length > 0) {
      if (!validateError) setError("");
      setFiles((current) => [...current, ...accepted]);
    }
  }

  async function submitReply(event: React.FormEvent) {
    event.preventDefault();
    if (!hasMeaningfulHtml(body) && files.length === 0) return;

    setSubmitting(true);
    setError("");
    onTypingStopped?.();
    try {
      const response = await fetch(`/api/v1/requests/${requestId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: hasMeaningfulHtml(body)
            ? body
            : buildAttachmentOnlyMessage(files.map((file) => file.name)),
          visibility: "CUSTOMER_VISIBLE",
          replyToMessageId: replyTarget?.id,
        }),
      });
      const payload = (await response.json()) as ApiPayload;
      if (!response.ok) {
        throw new Error(payload.error?.message || "回复发送失败");
      }
      const messageId = payload.data?.message?.id;
      if (attachmentsEnabled && files.length > 0) {
        if (!messageId) {
          throw new Error("回复已发送，但附件关联失败");
        }
        for (const file of files) {
          const formData = new FormData();
          formData.append("file", file);
          formData.append("serviceRequestId", requestId);
          formData.append("requestMessageId", messageId);
          formData.append("visibility", "CUSTOMER_VISIBLE");
          const uploadResponse = await fetch("/api/v1/attachments", {
            method: "POST",
            body: formData,
          });
          if (!uploadResponse.ok) {
            const uploadPayload = (await uploadResponse.json()) as ApiPayload;
            throw new Error(
              uploadPayload.error?.message || `${file.name} 上传失败`,
            );
          }
        }
      }
      setBody("");
      setFiles([]);
      onCancelReply?.();
      markRequestLocalMutation();
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "回复发送失败，请稍后重试",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (disabled) {
    return <Alert severity="info">该服务请求已关闭，不能继续回复。</Alert>;
  }

  return (
    <Paper
      component="form"
      variant="outlined"
      onSubmit={submitReply}
      sx={{ overflow: "hidden" }}
    >
      {submitting ? <LinearProgress /> : null}
      <Stack spacing={1.5} sx={{ p: 2 }}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {replyTarget ? (
          <RequestReplyPreview
            target={replyTarget}
            onCancel={() => onCancelReply?.()}
          />
        ) : null}
        <RichTextEditor
          value={body}
          onChange={(value) => {
            setBody(value);
            if (hasMeaningfulHtml(value)) {
              onTypingActivity?.();
            } else {
              onTypingStopped?.();
            }
          }}
          disabled={submitting}
          uploadImage={uploadInlineImage}
          onImageUploadingChange={setInlineImageUploading}
          placeholder="补充信息或回复处理人员"
        />
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          sx={{ justifyContent: "space-between", alignItems: { sm: "center" } }}
        >
          {attachmentsEnabled ? (
            <Button
              component="label"
              variant="outlined"
              startIcon={<AttachFileOutlinedIcon />}
              disabled={submitting}
            >
              添加附件
              <input
                hidden
                type="file"
                multiple
                accept={policy.accept}
                onChange={(event) => {
                  addFiles(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
            </Button>
          ) : (
            <Typography variant="body2" color="text.secondary">
              当前未开放客户回复附件
            </Typography>
          )}
          <Button
            type="submit"
            variant="contained"
            endIcon={<SendOutlinedIcon />}
            disabled={
              submitting ||
              inlineImageUploading ||
              (!hasMeaningfulHtml(body) && files.length === 0)
            }
            sx={{ alignSelf: { xs: "stretch", sm: "auto" } }}
          >
            {submitting ? "正在发送" : "发送回复"}
          </Button>
        </Stack>
        {attachmentsEnabled ? (
          <Typography variant="body2" color="text.secondary">
            支持粘贴图片；单文件不超过 {policy.maxSizeMb}MB；格式：
            {policy.allowedExtensions.join("、")}
          </Typography>
        ) : null}
        <RequestAttachmentDrafts
          files={files}
          onRemove={(index) =>
            setFiles((current) =>
              current.filter((_, fileIndex) => fileIndex !== index),
            )
          }
        />
      </Stack>
    </Paper>
  );
}
