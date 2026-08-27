"use client";

import { useState, useSyncExternalStore } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
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
import { ContentRiskNotice } from "@/components/shared/content-risk-notice";
import {
  FilePickerButton,
  firstFileRejectionMessage,
} from "@/components/shared/file-picker";
import { useToast } from "@/components/shared/toast-provider";
import { useAttachmentPolicy } from "@/hooks/use-attachment-policy";
import { useInlineImageUpload } from "@/hooks/use-inline-image-upload";
import { markRequestLocalMutation } from "@/hooks/use-request-realtime";
import { apiRequest, jsonRequest } from "@/lib/api-client";
import { fileNames, uploadFilesBestEffort } from "@/lib/file-upload";
import {
  appendDraftMeta,
  createAttachmentDrafts,
  type AttachmentDraft,
} from "@/lib/attachment-drafts";
import {
  buildAttachmentOnlyMessage,
  hasMeaningfulHtml,
} from "@/lib/message-content";
import {
  type ApiResponsePayload,
} from "@/lib/api-client-error";
import type { DeliveryFeedback } from "@/lib/operation-feedback";

type ApiPayload = ApiResponsePayload<{
  message?: { id: string };
  deliveryFeedback?: DeliveryFeedback;
}>;

const requestReplySchema = z
  .object({
    body: z.string(),
    files: z.array(z.custom<AttachmentDraft>()),
  })
  .refine(
    ({ body, files }) => hasMeaningfulHtml(body) || files.length > 0,
    { path: ["body"], message: "请输入回复内容或添加附件" },
  );

type RequestReplyValues = z.infer<typeof requestReplySchema>;

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
  contentRiskEnabled = false,
  initialBody = "",
  restoredAttachmentCount = 0,
  onSent,
}: {
  requestId: string;
  status: RequestStatus;
  disabled?: boolean;
  replyTarget?: ChatReplyTarget | null;
  onCancelReply?: () => void;
  onTypingActivity?: () => void;
  onTypingStopped?: () => void;
  contentRiskEnabled?: boolean;
  initialBody?: string;
  restoredAttachmentCount?: number;
  onSent?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const { policy, loading: attachmentPolicyLoading, validateFiles } =
    useAttachmentPolicy();
  const [editorVersion, setEditorVersion] = useState(0);
  const [inlineImageUploading, setInlineImageUploading] = useState(false);
  const [continueReply, setContinueReply] = useState(Boolean(initialBody));
  const interactive = useSyncExternalStore(
    subscribeToClientReady,
    () => true,
    () => false,
  );
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const {
    control,
    handleSubmit,
    getValues,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<RequestReplyValues>({
    resolver: zodResolver(requestReplySchema),
    defaultValues: { body: initialBody, files: [] },
  });
  const body = useWatch({ control, name: "body" });
  const files = useWatch({ control, name: "files" });

  const attachmentsEnabled =
    !attachmentPolicyLoading &&
    policy.customerReplyAttachmentsEnabled !== false;
  const uploadInlineImage = useInlineImageUpload({ requestId });
  const resolvedGateVisible =
    shouldShowResolvedReplyGate(status) && !continueReply;

  async function confirmClose() {
    setClosing(true);
    try {
      const result = await apiRequest<{
        deliveryFeedback?: DeliveryFeedback;
      }>(
        `/api/v1/requests/${requestId}/close`,
        jsonRequest("POST"),
        "确认关闭失败",
      );
      setCloseDialogOpen(false);
      toast.success("服务请求已确认关闭");
      toast.delivery(result.deliveryFeedback, "summary");
      markRequestLocalMutation();
      router.refresh();
    } catch (closeError) {
      toast.error(
        closeError instanceof Error ? closeError.message : "确认关闭失败",
      );
    } finally {
      setClosing(false);
    }
  }

  function addFiles(next: File[]) {
    const currentFiles = getValues("files");
    const { accepted, error: validateError } = validateFiles(
      next,
      currentFiles.length,
    );
    if (validateError) toast.warning(validateError);
    if (accepted.length > 0) {
      setValue(
        "files",
        [...currentFiles, ...createAttachmentDrafts(accepted)],
        { shouldDirty: true, shouldValidate: true },
      );
    }
  }

  function updateDraft(
    index: number,
    patch: Partial<Pick<AttachmentDraft, "title" | "note">>,
  ) {
    const currentFiles = getValues("files");
    setValue(
      "files",
      currentFiles.map((draft, draftIndex) =>
        draftIndex === index ? { ...draft, ...patch } : draft,
      ),
      { shouldDirty: true },
    );
  }

  async function submitReply(values: RequestReplyValues) {
    onTypingStopped?.();
    try {
      const result = await apiRequest<NonNullable<ApiPayload["data"]>>(
        `/api/v1/requests/${requestId}/messages`,
        jsonRequest("POST", {
          body: hasMeaningfulHtml(values.body)
            ? values.body
            : buildAttachmentOnlyMessage(
                values.files.map(
                  (draft) => draft.title.trim() || draft.file.name,
                ),
              ),
          visibility: "CUSTOMER_VISIBLE",
          replyToMessageId: replyTarget?.id,
        }),
        "回复发送失败",
      );
      const messageId = result.message?.id;
      let failedFiles: AttachmentDraft[] = [];
      if (attachmentsEnabled && values.files.length > 0) {
        if (!messageId) {
          failedFiles = values.files;
        } else {
          failedFiles = await uploadFilesBestEffort(
            values.files,
            async (draft) => {
              const formData = new FormData();
              formData.append("file", draft.file);
              formData.append("serviceRequestId", requestId);
              formData.append("requestMessageId", messageId);
              formData.append("visibility", "CUSTOMER_VISIBLE");
              appendDraftMeta(formData, draft);
              await apiRequest(
                "/api/v1/attachments",
                { method: "POST", body: formData },
                `${draft.file.name} 上传失败`,
              );
            },
          );
        }
      }
      reset({ body: "", files: [] });
      setEditorVersion((version) => version + 1);
      if (failedFiles.length > 0) {
        toast.warning(
          `回复已发送，但附件上传失败：${fileNames(failedFiles.map((draft) => draft.file))}。请重新添加附件。`,
        );
      } else {
        toast.success("回复已发送");
      }
      toast.delivery(result.deliveryFeedback, "summary");
      onCancelReply?.();
      onSent?.();
      markRequestLocalMutation();
      router.refresh();
    } catch (submitError) {
      toast.error(
        submitError instanceof Error
          ? submitError.message
          : "回复发送失败，请稍后重试",
      );
    }
  }

  if (disabled) {
    return <Alert severity="info">该服务请求已关闭，不能继续回复。</Alert>;
  }

  return (
    <Paper
      id="request-reply-composer"
      component="form"
      noValidate
      variant="outlined"
      onSubmit={handleSubmit(submitReply)}
      sx={{ overflow: "hidden" }}
    >
      {isSubmitting ? <LinearProgress /> : null}
      <Stack spacing={1.5} sx={{ p: 2 }}>
        {contentRiskEnabled ? <ContentRiskNotice audience="CUSTOMER" /> : null}
        {restoredAttachmentCount > 0 ? (
          <Alert severity="info">
            已恢复撤回消息的正文；原消息包含 {restoredAttachmentCount}
            个附件，请重新添加后再发送。
          </Alert>
        ) : null}
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
            <Controller
              name="body"
              control={control}
              render={({ field }) => (
                <RichTextEditor
                  key={editorVersion}
                  value={field.value}
                  onChange={(value) => {
                    field.onChange(value);
                    if (hasMeaningfulHtml(value)) {
                      onTypingActivity?.();
                    } else {
                      onTypingStopped?.();
                    }
                  }}
                  disabled={isSubmitting || resolvedGateVisible}
                  uploadImage={
                    attachmentsEnabled && !resolvedGateVisible
                      ? uploadInlineImage
                      : undefined
                  }
                  onImageUploadingChange={setInlineImageUploading}
                  minHeight={resolvedGateVisible ? 220 : undefined}
                  placeholder="补充信息或回复处理人员"
                />
              )}
            />
            {errors.body?.message && !resolvedGateVisible ? (
              <Typography variant="body2" color="error" sx={{ mt: 0.75 }}>
                {errors.body.message}
              </Typography>
            ) : null}
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
                <Typography sx={{ fontWeight: 650 }}>服务人员已标记解决</Typography>
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
              <FilePickerButton
                variant="outlined"
                startIcon={<AttachFileOutlinedIcon />}
                disabled={isSubmitting}
                multiple
                accept={policy.accept}
                maxSize={policy.maxSizeMb * 1024 * 1024}
                onFiles={addFiles}
                onRejected={(rejections) =>
                  toast.warning(firstFileRejectionMessage(rejections))
                }
              >
                添加附件
              </FilePickerButton>
            ) : null}
            <Button
              type="submit"
              variant="contained"
              endIcon={<SendOutlinedIcon />}
              disabled={
                isSubmitting ||
                inlineImageUploading ||
                (!hasMeaningfulHtml(body) && files.length === 0)
              }
              sx={{
                alignSelf: { xs: "stretch", sm: "auto" },
                ml: { sm: "auto" },
              }}
            >
              {isSubmitting ? "正在发送" : "发送回复"}
            </Button>
          </Stack>
        ) : null}
        {attachmentsEnabled && !resolvedGateVisible ? (
          <Typography variant="body2" color="text.secondary">
            可粘贴图片，单个附件最大 {policy.maxSizeMb}MB。
          </Typography>
        ) : null}
        {!resolvedGateVisible ? (
          <RequestAttachmentDrafts
            drafts={files}
            disabled={isSubmitting}
            onUpdate={updateDraft}
            onRemove={(index) =>
              setValue(
                "files",
                files.filter((_, fileIndex) => fileIndex !== index),
                { shouldDirty: true, shouldValidate: true },
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
