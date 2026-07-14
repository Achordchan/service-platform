"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Avatar,
  Box,
  Button,
  Chip,
  IconButton,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import VerifiedUserOutlinedIcon from "@mui/icons-material/VerifiedUserOutlined";
import { resolveAvatarSrc } from "@/lib/default-avatar";

export type ChatAttachment = {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  visibility?: "CUSTOMER_VISIBLE" | "INTERNAL";
};

export type ChatMessage = {
  id: string;
  body: string;
  authorId: string;
  authorName: string;
  authorImage?: string | null;
  authorPlatformRole?: string | null;
  createdAt: string;
  visibility?: "CUSTOMER_VISIBLE" | "INTERNAL";
  isSystem?: boolean;
  attachments: ChatAttachment[];
};

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const INITIAL_VISIBLE = 12;
const LOAD_MORE_STEP = 12;

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function looksLikeHtml(body: string) {
  return /<\/?[a-z][\s\S]*>/i.test(body);
}

function AttachmentList({
  files,
  tone,
}: {
  files: ChatAttachment[];
  tone: "self" | "other" | "internal" | "admin";
}) {
  if (files.length === 0) return null;
  return (
    <Stack spacing={1} sx={{ mt: 1.25 }}>
      {files.map((file) => (
        <Stack
          key={file.id}
          direction="row"
          spacing={1.25}
          sx={{
            alignItems: "center",
            p: 1.1,
            borderRadius: 1.5,
            bgcolor:
              tone === "self" || tone === "admin"
                ? "rgba(255,255,255,0.16)"
                : tone === "internal"
                  ? "#fff7ed"
                  : "#f8fafc",
            border: "1px solid",
            borderColor:
              tone === "self" || tone === "admin"
                ? "rgba(255,255,255,0.2)"
                : tone === "internal"
                  ? "#fed7aa"
                  : "divider",
          }}
        >
          <InsertDriveFileOutlinedIcon
            sx={{
              fontSize: 18,
              color:
                tone === "self" || tone === "admin"
                  ? "rgba(255,255,255,0.9)"
                  : "text.secondary",
            }}
          />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              variant="body2"
              noWrap
              sx={{
                fontWeight: 600,
                color:
                  tone === "self" || tone === "admin"
                    ? "common.white"
                    : "text.primary",
              }}
            >
              {file.originalName}
            </Typography>
            <Typography
              variant="caption"
              sx={{
                color:
                  tone === "self" || tone === "admin"
                    ? "rgba(255,255,255,0.78)"
                    : "text.secondary",
              }}
            >
              {formatSize(file.size)}
              {file.visibility === "INTERNAL" ? " · 内部附件" : ""}
            </Typography>
          </Box>
          <IconButton
            component={Link}
            href={`/api/v1/attachments/${file.id}`}
            aria-label={`下载 ${file.originalName}`}
            size="small"
            sx={{
              color:
                tone === "self" || tone === "admin"
                  ? "common.white"
                  : "text.secondary",
            }}
          >
            <DownloadOutlinedIcon fontSize="small" />
          </IconButton>
        </Stack>
      ))}
    </Stack>
  );
}

export function RequestChatThread({
  messages,
  currentUserId,
  emptyText = "暂无沟通记录",
}: {
  messages: ChatMessage[];
  currentUserId: string;
  emptyText?: string;
}) {
  const sorted = useMemo(
    () =>
      [...messages].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [messages],
  );
  const [extraVisible, setExtraVisible] = useState(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const previousLatestIdRef = useRef<string | null>(null);
  const previousScrollHeightRef = useRef(0);

  const baseVisible = Math.min(INITIAL_VISIBLE, sorted.length);
  const visibleCount = Math.min(sorted.length, baseVisible + extraVisible);
  const hiddenCount = Math.max(0, sorted.length - visibleCount);
  const visibleMessages = sorted.slice(hiddenCount);

  useLayoutEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;

    const latestId = sorted[sorted.length - 1]?.id ?? null;
    const latestChanged = latestId !== previousLatestIdRef.current;
    const prepended =
      previousScrollHeightRef.current > 0 &&
      node.scrollHeight > previousScrollHeightRef.current &&
      !latestChanged;

    if (prepended) {
      node.scrollTop =
        node.scrollHeight - previousScrollHeightRef.current + node.scrollTop;
    } else if (stickToBottomRef.current || latestChanged) {
      node.scrollTop = node.scrollHeight;
      stickToBottomRef.current = true;
    }

    previousLatestIdRef.current = latestId;
    previousScrollHeightRef.current = node.scrollHeight;
  }, [sorted, visibleMessages.length]);

  function loadEarlier() {
    const node = scrollerRef.current;
    if (node) {
      previousScrollHeightRef.current = node.scrollHeight;
      stickToBottomRef.current = false;
    }
    setExtraVisible((current) => current + LOAD_MORE_STEP);
  }

  if (sorted.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
        <Typography color="text.secondary">{emptyText}</Typography>
      </Paper>
    );
  }

  return (
    <Paper
      variant="outlined"
      sx={{
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        maxHeight: { xs: 460, md: 560 },
        overscrollBehavior: "contain",
        isolation: "isolate",
        minHeight: { xs: 320, md: 420 },
      }}
    >
      {hiddenCount > 0 ? (
        <Box
          sx={{
            px: 2,
            py: 1.25,
            borderBottom: "1px solid",
            borderColor: "divider",
            bgcolor: "background.paper",
          }}
        >
          <Button size="small" onClick={loadEarlier} fullWidth>
            加载更早的消息（还有 {hiddenCount} 条）
          </Button>
        </Box>
      ) : null}

      <Box
        ref={scrollerRef}
        onScroll={(event) => {
          const node = event.currentTarget;
          const distance =
            node.scrollHeight - node.scrollTop - node.clientHeight;
          stickToBottomRef.current = distance < 48;
        }}
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overscrollBehaviorY: "contain",
          overscrollBehavior: "contain",
          px: { xs: 1.5, md: 2 },
          py: 2,
          bgcolor: "#f7f8fa",
          touchAction: "pan-y",
        }}
        onWheel={(event) => {
          const node = event.currentTarget;
          const delta = event.deltaY;
          const atTop = node.scrollTop <= 0;
          const atBottom =
            node.scrollTop + node.clientHeight >= node.scrollHeight - 1;
          if ((delta < 0 && atTop) || (delta > 0 && atBottom)) {
            event.preventDefault();
          }
          event.stopPropagation();
        }}
      >
        <Stack spacing={1.5}>
          {visibleMessages.map((message) => {
            if (message.isSystem) {
              return (
                <Box
                  key={message.id}
                  sx={{
                    display: "flex",
                    justifyContent: "center",
                    px: 1,
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{
                      color: "text.secondary",
                      bgcolor: "rgba(15, 23, 42, 0.04)",
                      borderRadius: 999,
                      px: 1.5,
                      py: 0.5,
                      maxWidth: "90%",
                      textAlign: "center",
                      lineHeight: 1.5,
                    }}
                  >
                    {message.body}
                    <Box component="span" sx={{ opacity: 0.75 }}>
                      {" · "}
                      {dateFormatter.format(new Date(message.createdAt))}
                    </Box>
                  </Typography>
                </Box>
              );
            }
            const isSelf = message.authorId === currentUserId;
            const isInternal = message.visibility === "INTERNAL";
            const isAdmin = message.authorPlatformRole === "PLATFORM_ADMIN";
            const tone = isInternal
              ? "internal"
              : isSelf
                ? "self"
                : isAdmin
                  ? "admin"
                  : "other";
            const avatarSrc = resolveAvatarSrc(
              message.authorImage,
              message.authorName,
              message.authorId,
            );

            return (
              <Stack
                key={message.id}
                direction={isSelf ? "row-reverse" : "row"}
                spacing={1.25}
                sx={{ alignItems: "flex-end" }}
              >
                <Avatar
                  src={avatarSrc}
                  alt={message.authorName}
                  sx={{
                    width: 34,
                    height: 34,
                    fontSize: 14,
                    bgcolor: isInternal
                      ? "#fef3c7"
                      : isAdmin
                        ? "#111827"
                        : isSelf
                          ? "primary.main"
                          : "#e5e7eb",
                    color: isInternal
                      ? "#b54708"
                      : isAdmin || isSelf
                        ? "common.white"
                        : "text.secondary",
                  }}
                >
                  {message.authorName.slice(0, 1)}
                </Avatar>
                <Box
                  sx={{
                    maxWidth: { xs: "82%", md: "72%" },
                    minWidth: 0,
                  }}
                >
                  <Stack
                    direction={isSelf ? "row-reverse" : "row"}
                    spacing={1}
                    sx={{ mb: 0.5, alignItems: "center", px: 0.5 }}
                  >
                    <Typography variant="caption" sx={{ fontWeight: 650 }}>
                      {isSelf ? "我" : message.authorName}
                    </Typography>
                    {isAdmin ? (
                      <Chip
                        icon={<VerifiedUserOutlinedIcon />}
                        label="管理员"
                        size="small"
                        sx={{
                          height: 22,
                          bgcolor: "#111827",
                          color: "common.white",
                          "& .MuiChip-icon": { color: "common.white" },
                        }}
                      />
                    ) : null}
                    {isInternal ? (
                      <Chip
                        icon={<LockOutlinedIcon />}
                        label="内部备注"
                        size="small"
                        color="warning"
                        variant="outlined"
                        sx={{ height: 22 }}
                      />
                    ) : null}
                    <Typography variant="caption" color="text.secondary">
                      {dateFormatter.format(new Date(message.createdAt))}
                    </Typography>
                  </Stack>
                  <Box
                    sx={{
                      px: 1.75,
                      py: 1.35,
                      borderRadius: isSelf
                        ? "18px 18px 6px 18px"
                        : "18px 18px 18px 6px",
                      bgcolor: isInternal
                        ? "#fffbeb"
                        : isSelf
                          ? "primary.main"
                          : isAdmin
                            ? "#111827"
                            : "background.paper",
                      color:
                        (isSelf || isAdmin) && !isInternal
                          ? "common.white"
                          : "text.primary",
                      border: "1px solid",
                      borderColor: isInternal
                        ? "#fcd34d"
                        : isSelf
                          ? "primary.main"
                          : isAdmin
                            ? "#111827"
                            : "divider",
                      boxShadow: isSelf
                        ? "0 8px 20px rgba(37, 99, 235, 0.12)"
                        : isAdmin
                          ? "0 8px 20px rgba(17, 24, 39, 0.18)"
                          : "0 4px 14px rgba(15, 23, 42, 0.04)",
                      "& a": {
                        color:
                          (isSelf || isAdmin) && !isInternal
                            ? "common.white"
                            : "primary.main",
                        textDecoration: "underline",
                      },
                      "& p": { m: 0, mb: 0.75 },
                      "& p:last-child": { mb: 0 },
                      "& ul, & ol": { my: 0.5, pl: 2.25 },
                    }}
                  >
                    {looksLikeHtml(message.body) ? (
                      <Box
                        sx={{
                          lineHeight: 1.7,
                          wordBreak: "break-word",
                        }}
                        dangerouslySetInnerHTML={{ __html: message.body }}
                      />
                    ) : (
                      <Typography
                        sx={{
                          whiteSpace: "pre-wrap",
                          lineHeight: 1.7,
                          wordBreak: "break-word",
                        }}
                      >
                        {message.body}
                      </Typography>
                    )}
                    <AttachmentList files={message.attachments} tone={tone} />
                  </Box>
                </Box>
              </Stack>
            );
          })}
        </Stack>
      </Box>
    </Paper>
  );
}
