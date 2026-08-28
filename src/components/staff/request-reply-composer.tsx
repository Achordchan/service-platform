"use client";

import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
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
import {
  FilePickerButton,
  firstFileRejectionMessage,
} from "@/components/shared/file-picker";
import { RequestAttachmentDrafts } from "@/components/shared/request-chat-attachments";
import { RichTextEditor } from "@/components/shared/rich-text-editor";
import type { ChatReplyTarget } from "@/components/shared/request-chat-types";
import { RequestReplyPreview } from "@/components/shared/request-reply-preview";
import { ContentRiskNotice } from "@/components/shared/content-risk-notice";
import { DeliveryNotice } from "@/components/shared/delivery-notice";
import { useToast } from "@/components/shared/toast-provider";
import { SupportReplyAssistant } from "@/components/staff/support-reply-assistant";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";
import { useAttachmentPolicy } from "@/hooks/use-attachment-policy";
import { useInlineImageUpload } from "@/hooks/use-inline-image-upload";
import { markRequestLocalMutation } from "@/hooks/use-request-realtime";
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
import { deliveryOverridePayload } from "@/lib/delivery-notice";
import type { DeliveryFeedback } from "@/lib/operation-feedback";
import { useDeliveryChannelRule } from "@/hooks/use-delivery-channels";
import type { NotificationDeliveryOverride } from "@/modules/notifications/notification-delivery-override";

const requestReplyComposerSchema = z
  .object({
    body: z.string(),
    internal: z.boolean(),
    files: z.array(z.custom<AttachmentDraft>()),
  })
  .refine(
    ({ body, files }) => hasMeaningfulHtml(body) || files.length > 0,
    { path: ["body"], message: "请输入回复内容或添加附件" },
  );

type RequestReplyComposerValues = z.infer<typeof requestReplyComposerSchema>;

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
  const [editorVersion, setEditorVersion] = useState(0);
  const [playbookSending, setPlaybookSending] = useState(false);
  const [inlineImageUploading, setInlineImageUploading] = useState(false);
  // 本次发送的提醒方式覆盖；内部备注本来就不外发，不显示提示行
  const [deliveryOverride, setDeliveryOverride] =
    useState<NotificationDeliveryOverride>({});
  const deliveryRule = useDeliveryChannelRule("REQUEST_PUBLIC_MESSAGE");
  const {
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<RequestReplyComposerValues>({
    resolver: zodResolver(requestReplyComposerSchema),
    defaultValues: { body: initialBody, internal: false, files: [] },
  });
  const body = useWatch({ control, name: "body" });
  const internal = useWatch({ control, name: "internal" });
  const files = useWatch({ control, name: "files" });
  const internalReplyLocked = replyTarget?.visibility === "INTERNAL";
  const effectiveInternal = internalReplyLocked || internal;
  const busy = isSubmitting || playbookSending;
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
      setValue("files", [...files, ...createAttachmentDrafts(accepted)], {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  }

  function updateDraft(
    index: number,
    patch: Partial<Pick<AttachmentDraft, "title" | "note">>,
  ) {
    setValue(
      "files",
      files.map((draft, draftIndex) =>
        draftIndex === index ? { ...draft, ...patch } : draft,
      ),
      { shouldDirty: true },
    );
  }

  async function sendSupportPlaybook(playbookKey: string) {
    setPlaybookSending(true);
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
          ...deliveryOverridePayload(deliveryOverride, deliveryRule),
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
      setPlaybookSending(false);
    }
  }

  async function submit(values: RequestReplyComposerValues) {
    const submitInternal = internalReplyLocked || values.internal;
    onTypingStopped?.();
    try {
      const result = await staffApi<{
        message: { id: string };
        deliveryFeedback: DeliveryFeedback;
      }>(
        `/api/v1/requests/${requestId}/messages`,
        jsonRequest("POST", {
          body: hasMeaningfulHtml(values.body)
            ? values.body
            // 纯附件回复用文件名无关的占位哨兵（不把可变文件名写进不可变正文）
            : buildAttachmentOnlyMessage(),
          visibility: submitInternal ? "INTERNAL" : "CUSTOMER_VISIBLE",
          replyToMessageId: replyTarget?.id,
          ...(submitInternal
            ? {}
            : deliveryOverridePayload(deliveryOverride, deliveryRule)),
        }),
      );
      const failedFiles = await uploadFilesBestEffort(
        values.files,
        async (draft) => {
          const formData = new FormData();
          formData.append("file", draft.file);
          formData.append("serviceRequestId", requestId);
          formData.append("requestMessageId", result.message.id);
          formData.append(
            "visibility",
            submitInternal ? "INTERNAL" : "CUSTOMER_VISIBLE",
          );
          appendDraftMeta(formData, draft);
          await staffApi("/api/v1/attachments", {
            method: "POST",
            body: formData,
          });
        },
      );
      reset({ body: "", internal: false, files: [] });
      setEditorVersion((version) => version + 1);
      if (failedFiles.length > 0) {
        toast.warning(
          `${submitInternal ? "内部备注已保存" : "回复已发送"}，但附件上传失败：${fileNames(failedFiles.map((draft) => draft.file))}。请重新添加附件。`,
        );
      } else {
        toast.success(submitInternal ? "内部备注已保存" : "回复已发送");
      }
      toast.delivery(result.deliveryFeedback);
      onCancelReply?.();
      onSent?.();
      markRequestLocalMutation();
      router.refresh();
    } catch (submitError) {
      toast.error(
        submitError instanceof Error ? submitError.message : "回复发送失败",
      );
    }
  }

  return (
    <Paper
      id="request-reply-composer"
      component="form"
      variant="outlined"
      onSubmit={handleSubmit(submit)}
      sx={{ overflow: "hidden" }}
    >
      {busy ? <LinearProgress /> : null}
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
              disabled={busy || effectiveInternal}
              onSend={sendSupportPlaybook}
            />
          </Stack>
          <Controller
            name="internal"
            control={control}
            render={({ field }) => (
              <FormControlLabel
                control={
                  <Switch
                    checked={internalReplyLocked || field.value}
                    onChange={(_, checked) => field.onChange(checked)}
                    disabled={busy || internalReplyLocked || claimRequired}
                  />
                }
                label="仅内部可见"
              />
            )}
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
        <Controller
          name="body"
          control={control}
          render={({ field }) => (
            <RichTextEditor
              key={editorVersion}
              value={field.value}
              onChange={(value) => {
                field.onChange(value);
                if (!hasMeaningfulHtml(value)) {
                  onTypingStopped?.();
                }
              }}
              disabled={busy}
              uploadImage={uploadInlineImage}
              onImageUploadingChange={setInlineImageUploading}
              placeholder={
                effectiveInternal ? "记录内部处理信息" : "输入给客户的回复"
              }
            />
          )}
        />
        {errors.body?.message ? (
          <Typography variant="body2" color="error">
            {errors.body.message}
          </Typography>
        ) : null}
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          sx={{ justifyContent: "space-between" }}
        >
          <FilePickerButton
            variant="outlined"
            startIcon={<AttachFileOutlinedIcon />}
            disabled={busy}
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
          <Button
            type="submit"
            variant="contained"
            endIcon={<SendOutlinedIcon />}
            disabled={
              busy ||
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
        {effectiveInternal ? null : (
          <DeliveryNotice
            scene={{ scene: "REQUEST_PUBLIC_MESSAGE", requestId }}
            override={deliveryOverride}
            onOverrideChange={setDeliveryOverride}
            disabled={busy}
          />
        )}
        <Typography variant="body2" color="text.secondary">
          可粘贴图片，单个附件最大 {policy.maxSizeMb}MB。
        </Typography>
        <RequestAttachmentDrafts
          drafts={files}
          disabled={busy}
          onUpdate={updateDraft}
          onRemove={(index) =>
            setValue(
              "files",
              files.filter((_, fileIndex) => fileIndex !== index),
              { shouldDirty: true, shouldValidate: true },
            )
          }
        />
      </Stack>
    </Paper>
  );
}
