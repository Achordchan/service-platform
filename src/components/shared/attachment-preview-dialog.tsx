"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Box,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
} from "@mui/material";
import CloseOutlinedIcon from "@mui/icons-material/CloseOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";

// 上传前的本地文件预览（PR B 扩展为已上传附件的 URL 预览）
export type PreviewSource = {
  file: File;
  title?: string;
};

const TEXT_EXTENSIONS = /\.(?:txt|log|csv|json)$/i;
const TEXT_PREVIEW_MAX_BYTES = 256 * 1024;

type PreviewKind = "image" | "pdf" | "text" | "unsupported";

function previewKindOf(file: File): PreviewKind {
  if (file.type.startsWith("image/")) return "image";
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    return "pdf";
  }
  if (
    file.type.startsWith("text/") ||
    file.type === "application/json" ||
    TEXT_EXTENSIONS.test(file.name)
  ) {
    return "text";
  }
  return "unsupported";
}

function TextPreview({ file }: { file: File }) {
  const [content, setContent] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const slice = file.slice(0, TEXT_PREVIEW_MAX_BYTES);
    void slice
      .text()
      .then((text) => {
        if (cancelled) return;
        setTruncated(file.size > TEXT_PREVIEW_MAX_BYTES);
        setContent(text);
      })
      .catch(() => {
        if (!cancelled) setContent("");
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  if (content === null) {
    return (
      <Box sx={{ display: "grid", placeItems: "center", py: 6 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }
  return (
    <Box>
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 1.5,
          maxHeight: "60vh",
          overflow: "auto",
          fontSize: 13,
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          bgcolor: "action.hover",
          borderRadius: 1.5,
        }}
      >
        {content}
      </Box>
      {truncated ? (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
          文件较大，仅预览前 256KB 内容。
        </Typography>
      ) : null}
    </Box>
  );
}

export function AttachmentPreviewDialog({
  source,
  onClose,
}: {
  source: PreviewSource | null;
  onClose: () => void;
}) {
  const file = source?.file ?? null;
  const kind = file ? previewKindOf(file) : null;
  const objectUrl = useMemo(
    () =>
      file && (kind === "image" || kind === "pdf")
        ? URL.createObjectURL(file)
        : "",
    [file, kind],
  );
  useEffect(() => {
    if (!objectUrl) return;
    return () => URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

  return (
    <Dialog
      open={Boolean(source)}
      onClose={onClose}
      fullWidth
      maxWidth={kind === "pdf" ? "md" : "sm"}
    >
      <DialogTitle
        sx={{
          pr: 7,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {source?.title?.trim() || file?.name || "附件预览"}
        <IconButton
          onClick={onClose}
          aria-label="关闭预览"
          sx={{ position: "absolute", right: 12, top: 12 }}
        >
          <CloseOutlinedIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ pb: 3 }}>
        {file && kind === "image" ? (
          <Box
            component="img"
            src={objectUrl}
            alt={file.name}
            sx={{
              display: "block",
              maxWidth: "100%",
              maxHeight: "68vh",
              mx: "auto",
              borderRadius: 1,
            }}
          />
        ) : null}
        {file && kind === "pdf" ? (
          <Box
            component="iframe"
            src={objectUrl}
            title={file.name}
            sx={{
              display: "block",
              width: "100%",
              height: "70vh",
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 1,
            }}
          />
        ) : null}
        {file && kind === "text" ? <TextPreview file={file} /> : null}
        {file && kind === "unsupported" ? (
          <Box sx={{ textAlign: "center", py: 5 }}>
            <InsertDriveFileOutlinedIcon
              sx={{ fontSize: 44, color: "text.disabled" }}
            />
            <Typography color="text.secondary" sx={{ mt: 1.5 }}>
              该格式暂不支持上传前预览，上传后可下载查看。
            </Typography>
          </Box>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
