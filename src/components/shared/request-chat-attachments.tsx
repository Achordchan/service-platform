"use client";

import { useEffect, useState } from "react";
import {
  Box,
  Chip,
  IconButton,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import CloseOutlinedIcon from "@mui/icons-material/CloseOutlined";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import type { ChatAttachment } from "@/components/shared/request-chat-types";
import {
  AttachmentPreviewDialog,
  type PreviewSource,
} from "@/components/shared/attachment-preview-dialog";
import type { AttachmentDraft } from "@/lib/attachment-drafts";

type AttachmentTone = "self" | "other" | "internal" | "admin";

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function isImageMimeType(mimeType: string) {
  return mimeType.startsWith("image/");
}

function isDraftImage(file: File) {
  return (
    isImageMimeType(file.type) ||
    /\.(?:jpe?g|png|gif|webp)$/i.test(file.name)
  );
}

export function attachmentDisplayName(file: {
  originalName: string;
  title?: string | null;
}) {
  return file.title?.trim() || file.originalName;
}

function attachmentColors(tone: AttachmentTone) {
  const inverted = tone === "self" || tone === "admin";
  return {
    background: inverted
      ? "rgba(255,255,255,0.16)"
      : tone === "internal"
        ? "warning.light"
        : "action.hover",
    border: inverted
      ? "rgba(255,255,255,0.22)"
      : tone === "internal"
        ? "warning.main"
        : "divider",
    primary: inverted ? "common.white" : "text.primary",
    secondary: inverted ? "rgba(255,255,255,0.78)" : "text.secondary",
  };
}

function MessageImage({
  file,
  resolveUrl,
}: {
  file: ChatAttachment;
  resolveUrl?: (file: ChatAttachment, inline: boolean) => string;
}) {
  const inlineUrl = resolveUrl
    ? resolveUrl(file, true)
    : `/api/v1/attachments/${file.id}?disposition=inline`;
  return (
    <Box
      component="a"
      href={inlineUrl}
      target="_blank"
      rel="noopener noreferrer"
      sx={{
        display: "block",
        minWidth: 0,
        overflow: "hidden",
        borderRadius: 1.5,
        color: "inherit",
        textDecoration: "none",
      }}
    >
      <Box
        component="img"
        src={inlineUrl}
        alt={attachmentDisplayName(file)}
        loading="lazy"
        sx={{
          display: "block",
          width: "100%",
          maxHeight: 240,
          objectFit: "contain",
          bgcolor: "rgba(15,23,42,0.06)",
        }}
      />
    </Box>
  );
}

function MessageFile({
  file,
  tone,
  resolveUrl,
  onDownload,
}: {
  file: ChatAttachment;
  tone: AttachmentTone;
  resolveUrl?: (file: ChatAttachment, inline: boolean) => string;
  onDownload?: (file: ChatAttachment) => void;
}) {
  const colors = attachmentColors(tone);
  const displayName = attachmentDisplayName(file);
  return (
    <Stack
      direction="row"
      spacing={1.25}
      sx={{
        alignItems: "center",
        p: 1.1,
        borderRadius: 1.5,
        bgcolor: colors.background,
        border: "1px solid",
        borderColor: colors.border,
      }}
    >
      <InsertDriveFileOutlinedIcon
        sx={{ fontSize: 18, color: colors.secondary }}
      />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          variant="body2"
          noWrap
          sx={{ fontWeight: 600, color: colors.primary }}
        >
          {displayName}
        </Typography>
        <Typography variant="caption" sx={{ color: colors.secondary }}>
          {formatSize(file.size)}
          {file.title?.trim() && file.title.trim() !== file.originalName
            ? ` · ${file.originalName}`
            : ""}
          {file.visibility === "INTERNAL" ? " · 内部附件" : ""}
        </Typography>
        {file.note?.trim() ? (
          <Typography
            variant="caption"
            sx={{
              display: "block",
              color: colors.secondary,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            {file.note}
          </Typography>
        ) : null}
      </Box>
      <IconButton
        {...(onDownload
          ? { onClick: () => onDownload(file) }
          : {
              component: "a" as const,
              href: resolveUrl
                ? resolveUrl(file, false)
                : `/api/v1/attachments/${file.id}`,
            })}
        aria-label={`下载 ${displayName}`}
        size="small"
        sx={{ color: colors.secondary }}
      >
        <DownloadOutlinedIcon fontSize="small" />
      </IconButton>
    </Stack>
  );
}

export function RequestMessageAttachments({
  files,
  tone,
  resolveUrl,
  onDownload,
}: {
  files: ChatAttachment[];
  tone: AttachmentTone;
  resolveUrl?: (file: ChatAttachment, inline: boolean) => string;
  onDownload?: (file: ChatAttachment) => void;
}) {
  if (files.length === 0) return null;
  const images = files.filter((file) => isImageMimeType(file.mimeType));
  const documents = files.filter((file) => !isImageMimeType(file.mimeType));

  return (
    <Stack spacing={1} sx={{ mt: 1.25 }}>
      {images.length > 0 ? (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns:
              images.length > 1
                ? { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" }
                : "minmax(0, 1fr)",
            gap: 1,
          }}
        >
          {images.map((file) => (
            <MessageImage key={file.id} file={file} resolveUrl={resolveUrl} />
          ))}
        </Box>
      ) : null}
      {documents.map((file) => (
        <MessageFile
          key={file.id}
          file={file}
          tone={tone}
          resolveUrl={resolveUrl}
          onDownload={onDownload}
        />
      ))}
    </Stack>
  );
}

function DraftThumbnail({ file }: { file: File }) {
  const [source] = useState(() =>
    isDraftImage(file) ? URL.createObjectURL(file) : "",
  );

  useEffect(() => {
    if (!source) return;
    return () => {
      URL.revokeObjectURL(source);
    };
  }, [source]);

  if (!source) {
    return (
      <InsertDriveFileOutlinedIcon
        sx={{ fontSize: 24, color: "text.secondary" }}
      />
    );
  }
  return (
    <Box
      component="img"
      src={source}
      alt=""
      sx={{
        width: 44,
        height: 44,
        display: "block",
        objectFit: "cover",
        borderRadius: 1,
      }}
    />
  );
}

export function RequestAttachmentDrafts({
  drafts,
  onRemove,
  onUpdate,
  disabled = false,
}: {
  drafts: AttachmentDraft[];
  onRemove: (index: number) => void;
  onUpdate: (
    index: number,
    patch: Partial<Pick<AttachmentDraft, "title" | "note">>,
  ) => void;
  disabled?: boolean;
}) {
  const [preview, setPreview] = useState<PreviewSource | null>(null);
  if (drafts.length === 0) return null;

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.25,
        borderStyle: "dashed",
        borderColor: "primary.light",
        bgcolor: "rgba(37,99,235,0.035)",
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", mb: 1 }}
      >
        <Typography variant="body2" sx={{ fontWeight: 650 }}>
          待发送附件
        </Typography>
        <Chip size="small" label={`${drafts.length} 个`} />
        <Typography variant="caption" color="text.secondary">
          可修改展示标题、添加备注
        </Typography>
      </Stack>
      <Stack spacing={0.75}>
        {drafts.map((draft, index) => (
          <Paper
            key={draft.id}
            variant="outlined"
            sx={{ p: 1, bgcolor: "background.paper" }}
          >
            <Stack
              direction="row"
              spacing={1.1}
              sx={{ alignItems: "flex-start" }}
            >
              <Box
                onClick={() =>
                  setPreview({ file: draft.file, title: draft.title })
                }
                role="button"
                aria-label={`预览 ${draft.file.name}`}
                sx={{
                  width: 44,
                  height: 44,
                  flex: "0 0 44px",
                  display: "grid",
                  placeItems: "center",
                  overflow: "hidden",
                  borderRadius: 1,
                  bgcolor: "action.hover",
                  cursor: "pointer",
                }}
              >
                <DraftThumbnail file={draft.file} />
              </Box>
              <Stack spacing={0.75} sx={{ minWidth: 0, flex: 1 }}>
                <TextField
                  value={draft.title}
                  onChange={(event) =>
                    onUpdate(index, { title: event.target.value })
                  }
                  size="small"
                  fullWidth
                  label="展示标题"
                  disabled={disabled}
                  slotProps={{ htmlInput: { maxLength: 160 } }}
                />
                <TextField
                  value={draft.note}
                  onChange={(event) =>
                    onUpdate(index, { note: event.target.value })
                  }
                  size="small"
                  fullWidth
                  multiline
                  maxRows={3}
                  label="备注（可选）"
                  disabled={disabled}
                  slotProps={{ htmlInput: { maxLength: 500 } }}
                />
                <Typography variant="caption" color="text.secondary" noWrap>
                  {draft.file.name} · {formatSize(draft.file.size)}
                </Typography>
              </Stack>
              <Stack spacing={0.25}>
                <IconButton
                  size="small"
                  onClick={() =>
                    setPreview({ file: draft.file, title: draft.title })
                  }
                  aria-label={`预览 ${draft.file.name}`}
                >
                  <VisibilityOutlinedIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  onClick={() => onRemove(index)}
                  disabled={disabled}
                  aria-label={`移除 ${draft.file.name}`}
                >
                  <CloseOutlinedIcon fontSize="small" />
                </IconButton>
              </Stack>
            </Stack>
          </Paper>
        ))}
      </Stack>
      <AttachmentPreviewDialog
        source={preview}
        onClose={() => setPreview(null)}
      />
    </Paper>
  );
}
