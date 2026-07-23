"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import AttachFileOutlinedIcon from "@mui/icons-material/AttachFileOutlined";
import SendOutlinedIcon from "@mui/icons-material/SendOutlined";
import CheckCircleOutlineOutlinedIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import ReplayOutlinedIcon from "@mui/icons-material/ReplayOutlined";
import { RequestAttachmentDrafts } from "@/components/shared/request-chat-attachments";
import { RichTextEditor } from "@/components/shared/rich-text-editor";
import type { ChatReplyTarget } from "@/components/shared/request-chat-types";
import type { RequestStatus } from "@/components/customer/customer-types";
import { shouldShowResolvedReplyGate } from "@/components/customer/request-resolution-state";
import { RequestReplyPreview } from "@/components/shared/request-reply-preview";
import { useAttachmentPolicy } from "@/hooks/use-attachment-policy";
import { useInlineImageUpload } from "@/hooks/use-inline-image-upload";
import { markRequestLocalMutation } from "@/hooks/use-request-realtime";
import {
  buildAttachmentOnlyMessage,
  hasMeaningfulHtml,
} from "@/lib/message-content";
import {
  apiErrorMessage,
  readApiJson,
  type ApiResponsePayload,
} from "@/lib/api-client-error";

type ApiPayload = ApiResponsePayload<{
  message?: { id: string };
}>;

function subscribeToClientReady() {
  return () => undefined;
}

export function RequestReplyForm({
  requestId,
  status,
  disabled = false,
  replyTarget,
  onCancelReply,
  onTypingActivity,
  onTypingStopped,
}: {
  requestId: string;
  status: RequestStatus;
  disabled?: boolean;
  replyTarget?: ChatReplyTarget | null;
  onCancelReply?: () => void;
  onTypingActivity?: () => void;
  onTypingStopped?: () => void;
}) {
  const router = useRouter();
  const { policy, loading: attachmentPolicyLoading, validateFiles } =
    useAttachmentPolicy();
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [editorVersion, setEditorVersion] = useState(0);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [inlineImageUploading, setInlineImageUploading] = useState(false);
  const [continueReply, setContinueReply] = useState(false);
  const interactive = useSyncExternalStore(
    subscribeToClientReady,
    () => true,
    () => false,
  );
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [closing, setClosing] = useState(false);

  const attachmentsEnabled =
    !attachmentPolicyLoading &&
    policy.customerReplyAttachmentsEnabled !== false;
  const uploadInlineImage = useInlineImageUpload({ requestId });
  const resolvedGateVisible =
    shouldShowResolvedReplyGate(status) && !continueReply;

  async function confirmClose() {
    setClosing(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/requests/${requestId}/close`, {
        method: "POST",
      });
      const payload = await readApiJson<ApiResponsePayload>(response);
      if (!response.ok) {
        throw new Error(apiErrorMessage(response, payload, "确认关闭失败"));
      }
      setCloseDialogOpen(false);
      markRequestLocalMutation();
      router.refresh();
    } catch (closeError) {
      setError(
        closeError instanceof Error ? closeError.message : "确认关闭失败",
      );
    } finally {
      setClosing(false);
    }
  }

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
      const payload = await readApiJson<ApiPayload>(response);
      if (!response.ok || !payload?.data) {
        throw new Error(apiErrorMessage(response, payload, "回复发送失败"));
      }
      const messageId = payload.data.message?.id;
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
            const uploadPayload = await readApiJson<ApiPayload>(uploadResponse);
            throw new Error(
              apiErrorMessage(uploadResponse, uploadPayload, `${file.name} 上传失败`),
            );
          }
        }
      }
      setBody("");
      setEditorVersion((version) => version + 1);
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
        <Box sx={{ position: "relative" }}>
          <Box
            sx={{
              opacity: resolvedGateVisible ? 0.28 : 1,
              pointerEvents: resolvedGateVisible ? "none" : "auto",
            }}
          >
            <RichTextEditor
              key={editorVersion}
              value={body}
              onChange={(value) => {
                setBody(value);
                if (hasMeaningfulHtml(value)) {
                  onTypingActivity?.();
                } else {
                  onTypingStopped?.();
                }
              }}
              disabled={submitting || resolvedGateVisible}
              uploadImage={
                attachmentsEnabled && !resolvedGateVisible
                  ? uploadInlineImage
                  : undefined
              }
              onImageUploadingChange={setInlineImageUploading}
              minHeight={resolvedGateVisible ? 220 : undefined}
              placeholder="补充信息或回复处理人员"
            />
          </Box>
          {resolvedGateVisible ? (
            <Stack
              spacing={1.5}
              sx={{
                position: "absolute",
                inset: 0,
                zIndex: 1,
                alignItems: "center",
                justifyContent: "center",
                px: 2,
                textAlign: "center",
                bgcolor: (theme) => alpha(theme.palette.background.paper, 0.94),
              }}
            >
              <CheckCircleOutlineOutlinedIcon color="success" />
              <Box>
                <Typography sx={{ fontWeight: 700 }}>服务人员已标记解决</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  确认无误后可关闭；仍有问题可继续反馈，发送后恢复为处理中。7
                  天内没有确认或回复，系统将自动关闭。
                </Typography>
              </Box>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <Button
                  variant="outlined"
                  startIcon={<ReplayOutlinedIcon />}
                  disabled={!interactive}
                  onClick={() => setContinueReply(true)}
                >
                  继续反馈
                </Button>
                <Button
                  variant="contained"
                  startIcon={<CheckCircleOutlineOutlinedIcon />}
                  disabled={!interactive}
                  onClick={() => {
                    setError("");
                    setCloseDialogOpen(true);
                  }}
                >
                  确认关闭
                </Button>
              </Stack>
            </Stack>
          ) : null}
        </Box>
        {!resolvedGateVisible ? (
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1.5}
            sx={{
              justifyContent: "space-between",
              alignItems: { sm: "center" },
            }}
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
            ) : null}
            <Button
              type="submit"
              variant="contained"
              endIcon={<SendOutlinedIcon />}
              disabled={
                submitting ||
                inlineImageUploading ||
                (!hasMeaningfulHtml(body) && files.length === 0)
              }
              sx={{
                alignSelf: { xs: "stretch", sm: "auto" },
                ml: { sm: "auto" },
              }}
            >
              {submitting ? "正在发送" : "发送回复"}
            </Button>
          </Stack>
        ) : null}
        {attachmentsEnabled && !resolvedGateVisible ? (
          <Typography variant="body2" color="text.secondary">
            支持粘贴图片；单文件不超过 {policy.maxSizeMb}MB；格式：
            {policy.allowedExtensions.join("、")}
          </Typography>
        ) : null}
        {!resolvedGateVisible ? (
          <RequestAttachmentDrafts
            files={files}
            onRemove={(index) =>
              setFiles((current) =>
                current.filter((_, fileIndex) => fileIndex !== index),
              )
            }
          />
        ) : null}
      </Stack>
      <Dialog
        open={closeDialogOpen}
        onClose={closing ? undefined : () => setCloseDialogOpen(false)}
        fullWidth
        maxWidth="xs"
      >
        {closing ? <LinearProgress /> : null}
        <DialogTitle>确认关闭服务请求</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary">
            关闭后不能继续回复。如问题仍未解决，请取消并选择“继续反馈”。
          </Typography>
          {error ? (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setCloseDialogOpen(false)} disabled={closing}>
            取消
          </Button>
          <Button
            variant="contained"
            onClick={() => void confirmClose()}
            disabled={closing}
          >
            {closing ? "正在关闭" : "确认关闭"}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
