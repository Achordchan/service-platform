"use client";

import { useEffect, useState } from "react";
import {
  Box,
  Chip,
  IconButton,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import CloseOutlinedIcon from "@mui/icons-material/CloseOutlined";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import type { ChatAttachment } from "@/components/shared/request-chat-types";

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
        alt={file.originalName}
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
          {file.originalName}
        </Typography>
        <Typography variant="caption" sx={{ color: colors.secondary }}>
          {formatSize(file.size)}
          {file.visibility === "INTERNAL" ? " · 内部附件" : ""}
        </Typography>
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
        aria-label={`下载 ${file.originalName}`}
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
  files,
  onRemove,
}: {
  files: File[];
  onRemove: (index: number) => void;
}) {
  if (files.length === 0) return null;

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
        <Chip size="small" label={`${files.length} 个`} />
      </Stack>
      <Stack spacing={0.75}>
        {files.map((file, index) => (
          <Paper
            key={`${file.name}-${file.lastModified}-${file.size}-${file.type}-${index}`}
            variant="outlined"
            sx={{ p: 0.75, bgcolor: "background.paper" }}
          >
            <Stack
              direction="row"
              spacing={1.1}
              sx={{ alignItems: "center" }}
            >
              <Box
                sx={{
                  width: 44,
                  height: 44,
                  flex: "0 0 44px",
                  display: "grid",
                  placeItems: "center",
                  overflow: "hidden",
                  borderRadius: 1,
                  bgcolor: "action.hover",
                }}
              >
                <DraftThumbnail file={file} />
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" noWrap sx={{ fontWeight: 650 }}>
                  {file.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatSize(file.size)}
                  {isDraftImage(file) ? " · 图片预览" : ""}
                </Typography>
              </Box>
              <IconButton
                size="small"
                onClick={() => onRemove(index)}
                aria-label={`移除 ${file.name}`}
              >
                <CloseOutlinedIcon fontSize="small" />
              </IconButton>
            </Stack>
          </Paper>
        ))}
      </Stack>
    </Paper>
  );
}
