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
import { RichTextEditor } from "@/components/shared/rich-text-editor";
import { useAttachmentPolicy } from "@/hooks/use-attachment-policy";
import { markRequestLocalMutation } from "@/hooks/use-request-realtime";
import { hasMeaningfulHtml } from "@/lib/message-content";

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
}: {
  requestId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const { policy, validateFiles, filesFromClipboard } = useAttachmentPolicy();
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const attachmentsEnabled = policy.customerReplyAttachmentsEnabled !== false;

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
    try {
      const response = await fetch(`/api/v1/requests/${requestId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: hasMeaningfulHtml(body) ? body : "<p>（附件）</p>",
          visibility: "CUSTOMER_VISIBLE",
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
      onPaste={(event) => {
        if (!attachmentsEnabled) return;
        const imageFiles = filesFromClipboard(event.clipboardData);
        if (imageFiles.length > 0) {
          event.preventDefault();
          addFiles(imageFiles);
        }
      }}
      sx={{ overflow: "hidden" }}
    >
      {submitting ? <LinearProgress /> : null}
      <Stack spacing={1.5} sx={{ p: 2 }}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        <RichTextEditor
          value={body}
          onChange={setBody}
          disabled={submitting}
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
        {files.length > 0 ? (
          <Stack spacing={0.75}>
            {files.map((file, index) => (
              <Stack
                key={`${file.name}-${file.lastModified}-${index}`}
                direction="row"
                spacing={1}
                sx={{ justifyContent: "space-between", alignItems: "center" }}
              >
                <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
                  {file.name}
                </Typography>
                <Button
                  size="small"
                  color="inherit"
                  onClick={() =>
                    setFiles((current) =>
                      current.filter((_, fileIndex) => fileIndex !== index),
                    )
                  }
                >
                  移除
                </Button>
              </Stack>
            ))}
          </Stack>
        ) : null}
      </Stack>
    </Paper>
  );
}
