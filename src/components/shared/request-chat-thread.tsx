"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  alpha,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import ReplyOutlinedIcon from "@mui/icons-material/ReplyOutlined";
import VerifiedUserOutlinedIcon from "@mui/icons-material/VerifiedUserOutlined";
import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";
import { RequestMessageAttachments } from "@/components/shared/request-chat-attachments";
import type { ChatMessage } from "@/components/shared/request-chat-types";
import type { ChatAttachment } from "@/components/shared/request-chat-types";
import { RequestQuotedMessage } from "@/components/shared/request-reply-preview";
import { SupportPlaybookMessageCard } from "@/components/shared/support-playbook-message-card";
import { resolveAvatarSrc } from "@/lib/default-avatar";
import { resolveInlineAttachmentHtml } from "@/lib/message-content";

const INITIAL_VISIBLE = 30;
const LOAD_MORE_STEP = 30;

function RequestDateSeparator({ label }: { label: string }) {
  return (
    <Box
      role="separator"
      aria-label={label}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        px: { xs: 1, sm: 5 },
        py: 0.5,
      }}
    >
      <Box
        sx={(theme) => ({
          flex: 1,
          height: "1px",
          bgcolor: alpha(theme.palette.divider, 0.7),
        })}
      />
      <Typography
        variant="caption"
        sx={{ color: "text.disabled", lineHeight: 1, flexShrink: 0 }}
      >
        {label}
      </Typography>
      <Box
        sx={(theme) => ({
          flex: 1,
          height: "1px",
          bgcolor: alpha(theme.palette.divider, 0.7),
        })}
      />
    </Box>
  );
}

function looksLikeHtml(body: string) {
  return /<\/?[a-z][\s\S]*>/i.test(body);
}

/**
 * 重新编辑窗口是否还开着。服务端已经按同一时限决定要不要下发 reeditBody，这里
 * 只负责让停留在页面上不刷新的人也能看到入口到点消失；没有下发时限就以服务端
 * 给出的 reeditBody 为准。
 */
function reeditWindowOpen(message: ChatMessage, nowMs: number) {
  if (!message.reeditExpiresAt) return true;
  const expiresAtMs = new Date(message.reeditExpiresAt).getTime();
  return Number.isNaN(expiresAtMs) || expiresAtMs > nowMs;
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
          bgcolor: "action.selected",
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
  onRevoke,
  onReedit,
  counterpartTypingLabel,
  attachmentUrl,
  onPinAttachmentToProject,
  onAttachmentDownload,
  locale = "zh-CN",
  contentRiskEnabled = false,
  canViewRevokedContent = false,
}: {
  messages: ChatMessage[];
  currentUserId: string;
  emptyText?: string;
  onReply?: (message: ChatMessage) => void;
  onRevoke?: (message: ChatMessage) => void;
  onReedit?: (message: ChatMessage) => void;
  counterpartTypingLabel?: string | null;
  attachmentUrl?: (file: ChatAttachment, inline: boolean) => string;
  /** 「添加到项目文件」；未传则不渲染该入口（如 embed 门户） */
  onPinAttachmentToProject?: (file: ChatAttachment) => void;
  onAttachmentDownload?: (file: ChatAttachment) => void;
  locale?: string;
  contentRiskEnabled?: boolean;
  canViewRevokedContent?: boolean;
}) {
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
    [locale],
  );
  const dateSeparatorFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    [locale],
  );
  const sorted = useMemo(
    () =>
      [...messages].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [messages],
  );
  const [extraVisible, setExtraVisible] = useState(0);
  const [reeditNowMs, setReeditNowMs] = useState(() => Date.now());
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const loadingEarlierRef = useRef(false);
  const loadEarlierTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stickToBottomRef = useRef(true);
  const previousLatestIdRef = useRef<string | null>(null);
  const previousScrollHeightRef = useRef(0);

  const baseVisible = Math.min(INITIAL_VISIBLE, sorted.length);
  const visibleCount = Math.min(sorted.length, baseVisible + extraVisible);
  const hiddenCount = Math.max(0, sorted.length - visibleCount);
  const visibleMessages = sorted.slice(hiddenCount);

  // 到点自动收起「重新编辑」：只为最近的那个截止时刻排一个定时器，不做秒级轮询
  useEffect(() => {
    let nearest: number | null = null;
    for (const message of sorted) {
      if (!message.reeditBody || !message.reeditExpiresAt) continue;
      const expiresAtMs = new Date(message.reeditExpiresAt).getTime();
      if (Number.isNaN(expiresAtMs) || expiresAtMs <= reeditNowMs) continue;
      if (nearest === null || expiresAtMs < nearest) nearest = expiresAtMs;
    }
    if (nearest === null) return;
    const timer = setTimeout(
      () => setReeditNowMs(Date.now()),
      nearest - reeditNowMs + 250,
    );
    return () => clearTimeout(timer);
  }, [sorted, reeditNowMs]);

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

  const loadEarlier = useCallback(() => {
    if (loadingEarlierRef.current || hiddenCount === 0) return;
    const node = scrollerRef.current;
    if (node) {
      previousScrollHeightRef.current = node.scrollHeight;
      stickToBottomRef.current = false;
    }
    loadingEarlierRef.current = true;
    setLoadingEarlier(true);
    loadEarlierTimerRef.current = setTimeout(() => {
      setExtraVisible((current) => current + LOAD_MORE_STEP);
      loadingEarlierRef.current = false;
      setLoadingEarlier(false);
      loadEarlierTimerRef.current = null;
    }, 160);
  }, [hiddenCount]);

  useEffect(
    () => () => {
      if (loadEarlierTimerRef.current) {
        clearTimeout(loadEarlierTimerRef.current);
      }
    },
    [],
  );

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
        maxHeight: { xs: 460, md: "min(65vh, 640px)" },
        overscrollBehavior: "contain",
        isolation: "isolate",
        minHeight: { xs: 280, md: 360 },
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
          <Button
            size="small"
            onClick={loadEarlier}
            disabled={loadingEarlier}
            startIcon={
              loadingEarlier ? <CircularProgress size={15} /> : undefined
            }
            fullWidth
          >
            {loadingEarlier
              ? "正在加载更早的消息"
              : `加载更早的消息（还有 ${hiddenCount} 条）`}
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
          if (node.scrollTop <= 16 && hiddenCount > 0) {
            loadEarlier();
          }
        }}
        sx={(theme) => ({
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overscrollBehaviorY: "contain",
          overscrollBehavior: "contain",
          px: { xs: 1.5, md: 2 },
          py: 2,
          bgcolor: "grey.50",
          ...theme.applyStyles("dark", {
            bgcolor: "grey.900",
          }),
          touchAction: "pan-y",
        })}
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
        <Stack spacing={1}>
          {visibleMessages.map((message, index) => {
            const messageDate = new Date(message.createdAt);
            const previousMessage = visibleMessages[index - 1];
            const showDateSeparator =
              !previousMessage ||
              dateSeparatorFormatter.format(messageDate) !==
                dateSeparatorFormatter.format(
                  new Date(previousMessage.createdAt),
                );
            const dateSeparator = showDateSeparator ? (
              <RequestDateSeparator
                label={dateSeparatorFormatter.format(messageDate)}
              />
            ) : null;

            if (message.isSystem) {
              return (
                <Fragment key={message.id}>
                  {dateSeparator}
                  <Box
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
                        bgcolor: "action.hover",
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
                        {dateFormatter.format(messageDate)}
                      </Box>
                    </Typography>
                  </Box>
                </Fragment>
              );
            }
            const isSelf = message.authorId === currentUserId;
            const isInternal = message.visibility === "INTERNAL";
            const isAdmin = message.authorPlatformRole === "PLATFORM_ADMIN";
            const isRevoked = message.contentRiskStatus === "REVOKED";
            const showRevokedPlaceholder = isRevoked && !canViewRevokedContent;
            const isContinuation =
              !showDateSeparator &&
              previousMessage &&
              !previousMessage.isSystem &&
              previousMessage.authorId === message.authorId &&
              previousMessage.visibility === message.visibility &&
              messageDate.getTime() -
                new Date(previousMessage.createdAt).getTime() <
                120_000;
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
              <Fragment key={message.id}>
                {dateSeparator}
                <Stack
                  direction={isSelf ? "row-reverse" : "row"}
                  spacing={1.25}
                  sx={{ alignItems: "flex-end" }}
                >
                {isContinuation ? (
                  <Box sx={{ width: 34, flexShrink: 0 }} />
                ) : (
                <Avatar
                  src={avatarSrc}
                  alt={message.authorName}
                  sx={{
                    width: 34,
                    height: 34,
                    fontSize: 14,
                    bgcolor: isInternal
                      ? (theme) => alpha(theme.palette.warning.main, 0.16)
                      : isAdmin
                        ? "grey.800"
                        : isSelf
                          ? "primary.main"
                          : "action.selected",
                    color: isInternal
                      ? "warning.main"
                      : isAdmin || isSelf
                        ? "common.white"
                        : "text.secondary",
                  }}
                >
                  {message.authorName.slice(0, 1)}
                </Avatar>
                )}
                <Box
                  sx={{
                    width: "fit-content",
                    maxWidth: { xs: "86%", sm: "74%", md: "64%" },
                    minWidth: 0,
                    position: "relative",
                    "& .request-message-action": {
                      opacity: 0,
                      pointerEvents: "none",
                      transition: "opacity 120ms ease",
                    },
                    "&:hover .request-message-action, &:focus-within .request-message-action":
                      {
                        opacity: 1,
                        pointerEvents: "auto",
                      },
                    "@media (hover: none)": {
                      "& .request-message-action": {
                        opacity: 1,
                        pointerEvents: "auto",
                      },
                    },
                  }}
                >
                  {!isContinuation && (
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
                        sx={(theme) => ({
                          height: 22,
                          bgcolor: "grey.800",
                          color: "common.white",
                          "& .MuiChip-icon": { color: "common.white" },
                          ...theme.applyStyles("dark", {
                            bgcolor: "grey.600",
                          }),
                        })}
                      />
                    ) : null}
                    {message.authorSourceKey ? (
                      <Chip
                        label={message.authorSourceLabel ?? "外部接入"}
                        size="small"
                        variant="outlined"
                        sx={{ height: 22 }}
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
                    {onReply && !isRevoked ? (
                      <IconButton
                        className="request-message-action"
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
                    {onRevoke && !isRevoked && !isInternal && !message.isInitial ? (
                      <Tooltip title="撤回消息">
                        <IconButton
                          className="request-message-action"
                          size="small"
                          onClick={() => onRevoke(message)}
                          aria-label={`撤回 ${message.authorName} 的消息`}
                          sx={{
                            width: 26,
                            height: 26,
                            color: "error.main",
                          }}
                        >
                          <WarningAmberOutlinedIcon sx={{ fontSize: 17 }} />
                        </IconButton>
                      </Tooltip>
                    ) : null}
                  </Stack>
                  )}
                  <Box
                    sx={{
                      display: "block",
                      width: "fit-content",
                      minWidth: 52,
                      maxWidth: "100%",
                      ml: isSelf ? "auto" : 0,
                      mr: isSelf ? 0 : "auto",
                      px: 1.75,
                      py: 1.35,
                      borderRadius: isSelf
                        ? "18px 18px 6px 18px"
                        : "18px 18px 18px 6px",
                      bgcolor: showRevokedPlaceholder
                        ? (theme) => alpha(theme.palette.error.main, 0.08)
                        : isInternal
                          ? (theme) => alpha(theme.palette.warning.main, 0.12)
                          : isSelf
                            ? "primary.main"
                            : isAdmin
                              ? "grey.800"
                              : "background.paper",
                      color: showRevokedPlaceholder
                        ? "error.main"
                        : (isSelf || isAdmin) && !isInternal
                          ? "common.white"
                          : "text.primary",
                      border: "1px solid",
                      borderColor: showRevokedPlaceholder
                        ? (theme) => alpha(theme.palette.error.main, 0.32)
                        : isInternal
                          ? "warning.main"
                          : isSelf
                            ? "primary.main"
                            : isAdmin
                              ? "grey.800"
                              : "divider",
                      boxShadow: showRevokedPlaceholder
                        ? "0 4px 14px rgba(239, 68, 68, 0.06)"
                        : isSelf
                          ? "0 8px 20px rgba(37, 99, 235, 0.12)"
                          : isAdmin
                            ? "0 8px 20px rgba(17, 24, 39, 0.18)"
                            : "0 4px 14px rgba(15, 23, 42, 0.04)",
                      overflowWrap: "anywhere",
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
                        fontWeight: 650,
                      },
                      "& ul, & ol": { my: 0.5, pl: 2.25 },
                      "& img": {
                        display: "block",
                        maxWidth: "100%",
                        maxHeight: 420,
                        my: 1,
                        borderRadius: 1.5,
                        objectFit: "contain",
                      },
                    }}
                  >
                    {showRevokedPlaceholder ? (
                      <Stack
                        direction="row"
                        spacing={0.65}
                        role="status"
                        sx={{ alignItems: "flex-start", color: "error.main" }}
                      >
                        <WarningAmberOutlinedIcon
                          sx={{ fontSize: 16, flexShrink: 0, mt: "2px" }}
                        />
                        <Typography
                          variant="caption"
                          sx={{ color: "inherit", lineHeight: 1.55 }}
                        >
                          {message.contentRiskReason
                            ? `该内容已被系统撤回：${message.contentRiskReason}`
                            : contentRiskEnabled
                              ? "该内容已被系统撤回：疑似包含联系方式或站外交易引导。"
                              : "该内容已撤回"}
                        </Typography>
                      </Stack>
                    ) : (
                      <>
                        <RequestQuotedMessage
                          reference={message.replyTo}
                          unavailable={Boolean(
                            message.replyToMessageId && !message.replyTo,
                          )}
                          inverted={(isSelf || isAdmin) && !isInternal}
                        />
                        {message.supportPlaybook ? (
                          <SupportPlaybookMessageCard
                            playbook={message.supportPlaybook}
                            inverted={(isSelf || isAdmin) && !isInternal}
                            resolveImageUrl={(attachmentId) => {
                              const file = message.attachments.find(
                                (item) => item.id === attachmentId && item.inline,
                              );
                              if (!file) return "about:blank";
                              return attachmentUrl
                                ? attachmentUrl(file, true)
                                : `/api/v1/attachments/${file.id}?disposition=inline`;
                            }}
                          />
                        ) : looksLikeHtml(message.body) ? (
                          <Box
                            sx={{
                              lineHeight: 1.7,
                              wordBreak: "break-word",
                            }}
                            dangerouslySetInnerHTML={{
                              __html: resolveInlineAttachmentHtml(
                                message.body,
                                (attachmentId) => {
                                  const file = message.attachments.find(
                                    (item) =>
                                      item.id === attachmentId && item.inline,
                                  );
                                  if (!file) return "about:blank";
                                  return attachmentUrl
                                    ? attachmentUrl(file, true)
                                    : `/api/v1/attachments/${file.id}?disposition=inline`;
                                },
                              ),
                            }}
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
                          files={message.attachments.filter(
                            (file) =>
                              !file.inline && file.contentRiskStatus !== "REVOKED",
                          )}
                          tone={tone}
                          resolveUrl={attachmentUrl}
                          onDownload={onAttachmentDownload}
                          onPinToProject={onPinAttachmentToProject}
                        />
                        {isRevoked ? (
                          <Stack
                            direction="row"
                            spacing={0.65}
                            role="status"
                            sx={{
                              alignItems: "flex-start",
                              color: "error.main",
                              mt: 1.25,
                              pt: 1,
                              borderTop: "1px solid",
                              borderColor: "rgba(239, 68, 68, 0.24)",
                            }}
                          >
                            <WarningAmberOutlinedIcon
                              sx={{ fontSize: 16, flexShrink: 0, mt: "2px" }}
                            />
                            <Typography
                              variant="caption"
                              sx={{ color: "inherit", lineHeight: 1.55 }}
                            >
                              {message.contentRiskReason
                                ? `该内容已被系统撤回：${message.contentRiskReason}。原文仅平台管理员可见。`
                                : contentRiskEnabled
                                  ? "该内容已被系统撤回，原文仅平台管理员可见。"
                                  : "该内容已撤回，原文仅平台管理员可见。"}
                            </Typography>
                          </Stack>
                        ) : null}
                      </>
                    )}
                    {isRevoked &&
                    message.reeditBody &&
                    onReedit &&
                    reeditWindowOpen(message, reeditNowMs) ? (
                      <Button
                        size="small"
                        color="error"
                        variant="outlined"
                        startIcon={<EditOutlinedIcon />}
                        onClick={() => onReedit(message)}
                        sx={{ mt: 1.25 }}
                      >
                        重新编辑
                      </Button>
                    ) : null}
                  </Box>
                  {message.contentRiskStatus === "PENDING" ? (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block", mt: 0.5, px: 0.5 }}
                    >
                      内容已发送，正在进行安全复查
                    </Typography>
                  ) : null}
                </Box>
                </Stack>
              </Fragment>
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
