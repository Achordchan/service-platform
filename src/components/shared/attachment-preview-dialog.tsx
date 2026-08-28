"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
} from "@mui/material";
import CloseOutlinedIcon from "@mui/icons-material/CloseOutlined";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import { isTextPreviewMimeType } from "@/modules/attachments/attachment-meta";

// 预览来源：本地待上传文件（file）或已上传附件（remote，走内联下载 URL）
export type PreviewSource =
  | { type: "file"; file: File; title?: string }
  | {
      type: "remote";
      url: string;
      downloadUrl?: string;
      mimeType: string;
      name: string;
    };

const TEXT_EXTENSIONS = /\.(?:txt|log|csv|json)$/i;
const TEXT_PREVIEW_MAX_BYTES = 256 * 1024;

type PreviewKind = "image" | "pdf" | "text" | "unsupported";

function previewKindOfFile(file: File): PreviewKind {
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

export function previewKindOfMimeType(mimeType: string): PreviewKind {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  if (isTextPreviewMimeType(mimeType)) return "text";
  return "unsupported";
}

function TextContent({
  content,
  truncated,
}: {
  content: string;
  truncated: boolean;
}) {
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

function LocalTextPreview({ file }: { file: File }) {
  const [content, setContent] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void file
      .slice(0, TEXT_PREVIEW_MAX_BYTES)
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
  return <TextContent content={content} truncated={truncated} />;
}

function RemoteTextPreview({ url }: { url: string }) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; content: string; truncated: boolean }
  >({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    // 只消费响应流的前 256KB 即取消，大文件预览不用等整个下载完成
    void fetch(url, { credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok || !response.body) throw new Error("附件加载失败");
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        let exceeded = false;
        try {
          while (received <= TEXT_PREVIEW_MAX_BYTES) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.byteLength;
            if (received > TEXT_PREVIEW_MAX_BYTES) {
              exceeded = true;
              break;
            }
          }
        } finally {
          await reader.cancel().catch(() => undefined);
        }
        const merged = new Uint8Array(received);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const text = new TextDecoder("utf-8").decode(
          merged.slice(0, TEXT_PREVIEW_MAX_BYTES),
        );
        setState({ status: "ready", content: text, truncated: exceeded });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "附件加载失败",
        });
      });
    return () => controller.abort();
  }, [url]);

  if (state.status === "loading") {
    return (
      <Box sx={{ display: "grid", placeItems: "center", py: 6 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }
  if (state.status === "error") {
    return (
      <Typography color="text.secondary" sx={{ textAlign: "center", py: 5 }}>
        {state.message}
      </Typography>
    );
  }
  return <TextContent content={state.content} truncated={state.truncated} />;
}

export function AttachmentPreviewDialog({
  source,
  onClose,
}: {
  source: PreviewSource | null;
  onClose: () => void;
}) {
  const file = source?.type === "file" ? source.file : null;
  const kind: PreviewKind | null = source
    ? source.type === "file"
      ? previewKindOfFile(source.file)
      : previewKindOfMimeType(source.mimeType)
    : null;
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

  const displayName = source
    ? source.type === "file"
      ? source.title?.trim() || source.file.name
      : source.name
    : "";
  const mediaUrl = source?.type === "remote" ? source.url : objectUrl;
  const downloadUrl =
    source?.type === "remote" ? source.downloadUrl : undefined;

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
        {displayName || "附件预览"}
        <IconButton
          onClick={onClose}
          aria-label="关闭预览"
          sx={{ position: "absolute", right: 12, top: 12 }}
        >
          <CloseOutlinedIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ pb: 3 }}>
        {source && kind === "image" ? (
          <Box
            component="img"
            src={mediaUrl}
            alt={displayName}
            sx={{
              display: "block",
              maxWidth: "100%",
              maxHeight: "68vh",
              mx: "auto",
              borderRadius: 1,
            }}
          />
        ) : null}
        {source && kind === "pdf" ? (
          <Box
            component="iframe"
            src={mediaUrl}
            title={displayName}
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
        {source && kind === "text" ? (
          source.type === "file" ? (
            <LocalTextPreview file={source.file} />
          ) : (
            // key 保证换 URL 时重挂载回到 loading 态（effect 内不做同步 setState）
            <RemoteTextPreview key={source.url} url={source.url} />
          )
        ) : null}
        {source && kind === "unsupported" ? (
          <Box sx={{ textAlign: "center", py: 5 }}>
            <InsertDriveFileOutlinedIcon
              sx={{ fontSize: 44, color: "text.disabled" }}
            />
            <Typography color="text.secondary" sx={{ mt: 1.5 }}>
              {source.type === "file"
                ? "该格式暂不支持上传前预览，上传后可下载查看。"
                : "该格式暂不支持在线预览，请下载后查看。"}
            </Typography>
            {downloadUrl ? (
              <Button
                component="a"
                href={downloadUrl}
                startIcon={<DownloadOutlinedIcon />}
                sx={{ mt: 2 }}
              >
                下载文件
              </Button>
            ) : null}
          </Box>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
