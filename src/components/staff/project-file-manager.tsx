"use client";

import { useState } from "react";
import { useAttachmentPolicy } from "@/hooks/use-attachment-policy";
import { useRouter } from "next/navigation";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import FileUploadOutlinedIcon from "@mui/icons-material/FileUploadOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import {
  FilePickerButton,
  firstFileRejectionMessage,
} from "@/components/shared/file-picker";
import {
  AttachmentPreviewDialog,
  previewKindOfMimeType,
  type PreviewSource,
} from "@/components/shared/attachment-preview-dialog";
import { useToast } from "@/components/shared/toast-provider";
import {
  ContentRiskNotice,
  ContentRiskStatusLine,
} from "@/components/shared/content-risk-notice";
import type {
  ContentVisibility,
  RequestAttachment,
} from "@/components/staff/staff-types";
import type { DeliveryFeedback } from "@/lib/operation-feedback";
import {
  appendDraftMeta,
  createAttachmentDrafts,
  type AttachmentDraft,
} from "@/lib/attachment-drafts";
import { apiRequest } from "@/lib/api-client";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function ProjectFileManager({
  projectId,
  files,
  canUpload,
  contentRiskEnabled = false,
  contentRiskNoticeEnabled = false,
}: {
  projectId: string;
  files: RequestAttachment[];
  canUpload: boolean;
  contentRiskEnabled?: boolean;
  contentRiskNoticeEnabled?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const { policy } = useAttachmentPolicy();
  const [visibility, setVisibility] =
    useState<ContentVisibility>("CUSTOMER_VISIBLE");
  const [draft, setDraft] = useState<AttachmentDraft | null>(null);
  const [preview, setPreview] = useState<PreviewSource | null>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(current: AttachmentDraft) {
    setUploading(true);
    const body = new FormData();
    body.append("file", current.file);
    body.append("projectId", projectId);
    body.append("visibility", visibility);
    appendDraftMeta(body, current);
    try {
      const result = await apiRequest<{
        deliveryFeedback?: DeliveryFeedback | null;
      }>("/api/v1/attachments", { method: "POST", body }, "文件上传失败");
      toast.success(
        visibility === "CUSTOMER_VISIBLE"
          ? "文件已上传，客户可在项目中查看"
          : "内部文件已上传",
      );
      toast.delivery(result.deliveryFeedback);
      setDraft(null);
      router.refresh();
    } catch (uploadError) {
      toast.error(
        uploadError instanceof Error ? uploadError.message : "文件上传失败",
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <Stack spacing={2}>
      {canUpload ? (
        <Paper variant="outlined" sx={{ p: 2 }}>
          {contentRiskNoticeEnabled && visibility === "CUSTOMER_VISIBLE" ? (
            <ContentRiskNotice audience="STAFF" />
          ) : null}
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1.5}
            sx={{ alignItems: { sm: "center" } }}
          >
            <TextField
              select
              label="可见范围"
              value={visibility}
              onChange={(event) =>
                setVisibility(event.target.value as ContentVisibility)
              }
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="CUSTOMER_VISIBLE">客户可见</MenuItem>
              <MenuItem value="INTERNAL">仅内部可见</MenuItem>
            </TextField>
            <FilePickerButton
              variant="contained"
              startIcon={<FileUploadOutlinedIcon />}
              disabled={uploading}
              accept={policy.accept}
              maxSize={policy.maxSizeMb * 1024 * 1024}
              onFiles={([file]) => {
                if (file) {
                  setDraft(createAttachmentDrafts([file])[0] ?? null);
                }
              }}
              onRejected={(rejections) =>
                toast.warning(firstFileRejectionMessage(rejections))
              }
            >
              选择文件
            </FilePickerButton>
            <Typography variant="body2" color="text.secondary">
              单个文件不超过 {policy.maxSizeMb}MB
            </Typography>
          </Stack>
        </Paper>
      ) : null}
      <Paper variant="outlined">
        {files.map((file, index) => (
          <Stack
            key={file.id}
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            sx={{
              px: 2.5,
              py: 2,
              borderBottom:
                index === files.length - 1 ? 0 : "1px solid",
              borderColor: "divider",
              alignItems: { sm: "center" },
              justifyContent: "space-between",
            }}
          >
            <div>
              {file.contentRiskStatus === "REVOKED" ? (
                <ContentRiskStatusLine
                  status="REVOKED"
                  pluginEnabled={contentRiskEnabled}
                />
              ) : (
                <>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Typography sx={{ fontWeight: 650 }}>
                  {file.title?.trim() || file.originalName}
                </Typography>
                {file.visibility === "INTERNAL" ? (
                  <LockOutlinedIcon fontSize="small" color="action" />
                ) : null}
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {dateFormatter.format(new Date(file.createdAt))}
                {file.title?.trim() && file.title.trim() !== file.originalName
                  ? ` · ${file.originalName}`
                  : ""}
              </Typography>
              {file.note?.trim() ? (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                >
                  {file.note}
                </Typography>
              ) : null}
                </>
              )}
            </div>
            {file.contentRiskStatus !== "REVOKED" ? (
              <Stack direction="row" spacing={1}>
                {previewKindOfMimeType(file.mimeType) !== "unsupported" ||
                file.previewStatus === "READY" ? (
                  <Button
                    variant="text"
                    onClick={() =>
                      setPreview(
                        previewKindOfMimeType(file.mimeType) === "unsupported"
                          ? {
                              type: "remote",
                              url: `/api/v1/attachments/${file.id}?disposition=inline&variant=preview`,
                              downloadUrl: `/api/v1/attachments/${file.id}`,
                              mimeType: "application/pdf",
                              name: file.title?.trim() || file.originalName,
                            }
                          : {
                              type: "remote",
                              url: `/api/v1/attachments/${file.id}?disposition=inline`,
                              downloadUrl: `/api/v1/attachments/${file.id}`,
                              mimeType: file.mimeType,
                              name: file.title?.trim() || file.originalName,
                            },
                      )
                    }
                  >
                    预览
                  </Button>
                ) : null}
                <Button
                  component="a"
                  href={`/api/v1/attachments/${file.id}`}
                  variant="outlined"
                >
                  下载
                </Button>
              </Stack>
            ) : null}
          </Stack>
        ))}
        {files.length === 0 ? (
          <Typography
            color="text.secondary"
            sx={{ px: 2.5, py: 5, textAlign: "center" }}
          >
            暂无项目文件
          </Typography>
        ) : null}
      </Paper>

      <Dialog
        open={Boolean(draft)}
        onClose={uploading ? undefined : () => setDraft(null)}
        fullWidth
        maxWidth="sm"
      >
        {uploading ? <LinearProgress /> : null}
        <DialogTitle>上传项目文件</DialogTitle>
        {draft ? (
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 0.5 }}>
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: "center", minWidth: 0 }}
              >
                <Typography
                  variant="body2"
                  color="text.secondary"
                  noWrap
                  sx={{ flex: 1 }}
                >
                  {draft.file.name} ·{" "}
                  {(draft.file.size / 1024 / 1024).toFixed(2)} MB
                  {visibility === "INTERNAL" ? " · 仅内部可见" : " · 客户可见"}
                </Typography>
                <Button
                  size="small"
                  startIcon={<VisibilityOutlinedIcon />}
                  onClick={() =>
                    setPreview({
                      type: "file",
                      file: draft.file,
                      title: draft.title,
                    })
                  }
                >
                  预览
                </Button>
              </Stack>
              <TextField
                label="展示标题"
                value={draft.title}
                onChange={(event) =>
                  setDraft({ ...draft, title: event.target.value })
                }
                fullWidth
                disabled={uploading}
                helperText="默认使用文件名，客户列表中按此标题展示"
                slotProps={{ htmlInput: { maxLength: 160 } }}
              />
              <TextField
                label="备注（可选）"
                value={draft.note}
                onChange={(event) =>
                  setDraft({ ...draft, note: event.target.value })
                }
                fullWidth
                multiline
                minRows={2}
                maxRows={4}
                disabled={uploading}
                slotProps={{ htmlInput: { maxLength: 500 } }}
              />
            </Stack>
          </DialogContent>
        ) : null}
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDraft(null)} disabled={uploading}>
            取消
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              if (draft) void upload(draft);
            }}
            disabled={uploading}
          >
            {uploading ? "正在上传" : "确认上传"}
          </Button>
        </DialogActions>
      </Dialog>
      <AttachmentPreviewDialog
        source={preview}
        onClose={() => setPreview(null)}
      />
    </Stack>
  );
}
