"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
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
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import ReplyOutlinedIcon from "@mui/icons-material/ReplyOutlined";
import VerifiedUserOutlinedIcon from "@mui/icons-material/VerifiedUserOutlined";
import { RequestMessageAttachments } from "@/components/shared/request-chat-attachments";
import type { ChatMessage } from "@/components/shared/request-chat-types";
import { RequestQuotedMessage } from "@/components/shared/request-reply-preview";
import { resolveAvatarSrc } from "@/lib/default-avatar";

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

function looksLikeHtml(body: string) {
  return /<\/?[a-z][\s\S]*>/i.test(body);
}

function RequestTypingBubble({ label }: { label: string }) {
  return (
    <Stack
      direction="row"
      spacing={1.25}
      role="status"
      aria-live="polite"
      sx={{ alignItems: "flex-end" }}
    >
      <Avatar
        sx={{
          width: 34,
          height: 34,
          fontSize: 14,
          bgcolor: "#e5e7eb",
          color: "text.secondary",
        }}
      >
        {label.slice(0, 1)}
      </Avatar>
      <Box
        sx={{
          px: 1.75,
          py: 1.15,
          borderRadius: "18px 18px 18px 6px",
          bgcolor: "background.paper",
          border: "1px solid",
          borderColor: "divider",
          boxShadow: "0 4px 14px rgba(15, 23, 42, 0.04)",
        }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Stack direction="row" spacing={0.45}>
            {[0, 1, 2].map((index) => (
              <Box
                key={index}
                sx={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  bgcolor: "text.secondary",
                  animation: "requestTypingPulse 1.2s ease-in-out infinite",
                  animationDelay: `${index * 160}ms`,
                  "@keyframes requestTypingPulse": {
                    "0%, 60%, 100%": {
                      opacity: 0.35,
                      transform: "translateY(0)",
                    },
                    "30%": {
                      opacity: 1,
                      transform: "translateY(-2px)",
                    },
                  },
                }}
              />
            ))}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {label}正在输入
          </Typography>
        </Stack>
      </Box>
    </Stack>
  );
}

export function RequestChatThread({
  messages,
  currentUserId,
  emptyText = "暂无沟通记录",
  onReply,
  counterpartTypingLabel,
}: {
  messages: ChatMessage[];
  currentUserId: string;
  emptyText?: string;
  onReply?: (message: ChatMessage) => void;
  counterpartTypingLabel?: string | null;
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
  }, [counterpartTypingLabel, sorted, visibleMessages.length]);

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
                    position: "relative",
                    "& .request-message-reply": {
                      opacity: 0,
                      pointerEvents: "none",
                      transition: "opacity 120ms ease",
                    },
                    "&:hover .request-message-reply, &:focus-within .request-message-reply":
                      {
                        opacity: 1,
                        pointerEvents: "auto",
                      },
                    "@media (hover: none)": {
                      "& .request-message-reply": {
                        opacity: 1,
                        pointerEvents: "auto",
                      },
                    },
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
                    {onReply ? (
                      <IconButton
                        className="request-message-reply"
                        size="small"
                        onClick={() => onReply(message)}
                        aria-label={`回复 ${message.authorName} 的消息`}
                        sx={{
                          width: 26,
                          height: 26,
                          color: "text.secondary",
                        }}
                      >
                        <ReplyOutlinedIcon sx={{ fontSize: 17 }} />
                      </IconButton>
                    ) : null}
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
                      "& h1, & h2, & h3": {
                        m: 0,
                        mb: 0.75,
                        fontSize: "1rem",
                        lineHeight: 1.5,
                        fontWeight: 750,
                      },
                      "& ul, & ol": { my: 0.5, pl: 2.25 },
                    }}
                  >
                    <RequestQuotedMessage
                      reference={message.replyTo}
                      unavailable={Boolean(
                        message.replyToMessageId && !message.replyTo,
                      )}
                      inverted={(isSelf || isAdmin) && !isInternal}
                    />
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
                    <RequestMessageAttachments
                      files={message.attachments}
                      tone={tone}
                    />
                  </Box>
                </Box>
              </Stack>
            );
          })}
          {counterpartTypingLabel ? (
            <RequestTypingBubble label={counterpartTypingLabel} />
          ) : null}
        </Stack>
      </Box>
    </Paper>
  );
}
