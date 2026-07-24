"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Button,
  FormControlLabel,
  LinearProgress,
  Paper,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import AttachFileOutlinedIcon from "@mui/icons-material/AttachFileOutlined";
import SendOutlinedIcon from "@mui/icons-material/SendOutlined";
import { RequestAttachmentDrafts } from "@/components/shared/request-chat-attachments";
import { RichTextEditor } from "@/components/shared/rich-text-editor";
import type { ChatReplyTarget } from "@/components/shared/request-chat-types";
import { RequestReplyPreview } from "@/components/shared/request-reply-preview";
import { ContentRiskNotice } from "@/components/shared/content-risk-notice";
import { useToast } from "@/components/shared/toast-provider";
import { SupportReplyAssistant } from "@/components/staff/support-reply-assistant";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";
import { useAttachmentPolicy } from "@/hooks/use-attachment-policy";
import { useInlineImageUpload } from "@/hooks/use-inline-image-upload";
import { markRequestLocalMutation } from "@/hooks/use-request-realtime";
import {
  buildAttachmentOnlyMessage,
  hasMeaningfulHtml,
} from "@/lib/message-content";
import type { DeliveryFeedback } from "@/lib/operation-feedback";

export function RequestReplyComposer({
  requestId,
  replyTarget,
  onCancelReply,
  claimRequired = false,
  onTypingActivity,
  onTypingStopped,
  contentRiskEnabled = false,
  initialBody = "",
  restoredAttachmentCount = 0,
  onSent,
}: {
  requestId: string;
  replyTarget?: ChatReplyTarget | null;
  onCancelReply?: () => void;
  claimRequired?: boolean;
  onTypingActivity?: (
    visibility: "CUSTOMER_VISIBLE" | "INTERNAL",
  ) => void;
  onTypingStopped?: () => void;
  contentRiskEnabled?: boolean;
  initialBody?: string;
  restoredAttachmentCount?: number;
  onSent?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const { policy, validateFiles } = useAttachmentPolicy();
  const [body, setBody] = useState(initialBody);
  const [internal, setInternal] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [editorVersion, setEditorVersion] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [inlineImageUploading, setInlineImageUploading] = useState(false);
  const internalReplyLocked = replyTarget?.visibility === "INTERNAL";
  const effectiveInternal = internalReplyLocked || internal;
  const uploadInlineImage = useInlineImageUpload({
    requestId,
    visibility: effectiveInternal ? "INTERNAL" : "CUSTOMER_VISIBLE",
  });

  useEffect(() => {
    if (!hasMeaningfulHtml(body)) return;
    onTypingActivity?.(
      effectiveInternal ? "INTERNAL" : "CUSTOMER_VISIBLE",
    );
  }, [body, effectiveInternal, onTypingActivity]);

  function addFiles(next: File[]) {
    const { accepted, error: validateError } = validateFiles(next, files.length);
    if (validateError) toast.warning(validateError);
    if (accepted.length > 0) {
      setFiles((current) => [...current, ...accepted]);
    }
  }

  async function sendSupportPlaybook(playbookKey: string) {
    setSubmitting(true);
    try {
      const result = await staffApi<{
        message: { id: string };
        deliveryFeedback: DeliveryFeedback;
      }>(`/api/v1/requests/${requestId}/messages`,
        jsonRequest("POST", {
          body: "",
          visibility: "CUSTOMER_VISIBLE",
          replyToMessageId: replyTarget?.id,
          supportPlaybookKey: playbookKey,
        }),
      );
      toast.success("处理指南已发送");
      toast.delivery(result.deliveryFeedback);
      onCancelReply?.();
      onSent?.();
      markRequestLocalMutation();
      router.refresh();
    } catch (sendError) {
      const message =
        sendError instanceof Error ? sendError.message : "处理指南发送失败";
      toast.error(message);
      throw new Error(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasMeaningfulHtml(body) && files.length === 0) return;
    setSubmitting(true);
    onTypingStopped?.();
    try {
      const result = await staffApi<{
        message: { id: string };
        deliveryFeedback: DeliveryFeedback;
      }>(
        `/api/v1/requests/${requestId}/messages`,
        jsonRequest("POST", {
          body: hasMeaningfulHtml(body)
            ? body
            : buildAttachmentOnlyMessage(files.map((file) => file.name)),
          visibility: effectiveInternal ? "INTERNAL" : "CUSTOMER_VISIBLE",
          replyToMessageId: replyTarget?.id,
        }),
      );
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("serviceRequestId", requestId);
        formData.append("requestMessageId", result.message.id);
        formData.append(
          "visibility",
          effectiveInternal ? "INTERNAL" : "CUSTOMER_VISIBLE",
        );
        await staffApi("/api/v1/attachments", {
          method: "POST",
          body: formData,
        });
      }
      setBody("");
      setEditorVersion((version) => version + 1);
      setFiles([]);
      setInternal(false);
      toast.success(effectiveInternal ? "内部备注已保存" : "回复已发送");
      toast.delivery(result.deliveryFeedback);
      onCancelReply?.();
      onSent?.();
      markRequestLocalMutation();
      router.refresh();
    } catch (submitError) {
      toast.error(
        submitError instanceof Error ? submitError.message : "回复发送失败",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Paper
      id="request-reply-composer"
      component="form"
      variant="outlined"
      onSubmit={submit}
      sx={{ overflow: "hidden" }}
    >
      {submitting ? <LinearProgress /> : null}
      <Stack spacing={1.5} sx={{ p: { xs: 2, md: 2.5 } }}>
        {replyTarget ? (
          <RequestReplyPreview
            target={replyTarget}
            onCancel={() => onCancelReply?.()}
          />
        ) : null}
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{ justifyContent: "space-between" }}
        >
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ alignItems: "center", flexWrap: "wrap" }}
          >
            <Typography sx={{ fontWeight: 650 }}>
              {effectiveInternal
                ? "添加内部备注"
                : claimRequired
                  ? "回复客户并接手"
                  : "回复客户"}
            </Typography>
            <SupportReplyAssistant
              disabled={submitting || effectiveInternal}
              onSend={sendSupportPlaybook}
            />
          </Stack>
          <FormControlLabel
            control={
              <Switch
                checked={effectiveInternal}
                onChange={(event) => setInternal(event.target.checked)}
                disabled={
                  submitting || internalReplyLocked || claimRequired
                }
              />
            }
            label="仅内部可见"
          />
        </Stack>
        {effectiveInternal ? (
          <Alert severity="warning">内部备注不会发送给客户。</Alert>
        ) : contentRiskEnabled ? (
          <ContentRiskNotice audience="STAFF" />
        ) : null}
        {restoredAttachmentCount > 0 ? (
          <Alert severity="info">
            已恢复撤回消息的正文；原消息包含 {restoredAttachmentCount}
            个附件，请重新添加后再发送。
          </Alert>
        ) : null}
        <RichTextEditor
          key={editorVersion}
          value={body}
          onChange={(value) => {
            setBody(value);
            if (!hasMeaningfulHtml(value)) {
              onTypingStopped?.();
            }
          }}
          disabled={submitting}
          uploadImage={uploadInlineImage}
          onImageUploadingChange={setInlineImageUploading}
          placeholder={
            effectiveInternal ? "记录内部处理信息" : "输入给客户的回复"
          }
        />
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          sx={{ justifyContent: "space-between" }}
        >
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
          <Button
            type="submit"
            variant="contained"
            endIcon={<SendOutlinedIcon />}
            disabled={
              submitting ||
              inlineImageUploading ||
              (!hasMeaningfulHtml(body) && files.length === 0)
            }
          >
            {effectiveInternal
              ? "保存备注"
              : claimRequired
                ? "回复并接手"
                : "发送回复"}
          </Button>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          支持粘贴图片；单文件不超过 {policy.maxSizeMb}MB；格式：
          {policy.allowedExtensions.join("、")}
        </Typography>
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
