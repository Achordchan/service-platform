"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  AppBar,
  Badge,
  Box,
  Button,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import ArrowBackOutlinedIcon from "@mui/icons-material/ArrowBackOutlined";
import AttachFileOutlinedIcon from "@mui/icons-material/AttachFileOutlined";
import CloseOutlinedIcon from "@mui/icons-material/CloseOutlined";
import SendOutlinedIcon from "@mui/icons-material/SendOutlined";
import { RequestChatHeading } from "@/components/shared/request-chat-heading";
import { RequestChatThread } from "@/components/shared/request-chat-thread";
import type {
  ChatAttachment,
  ChatMessage,
  ChatReplyTarget,
} from "@/components/shared/request-chat-types";
import { RequestAttachmentDrafts } from "@/components/shared/request-chat-attachments";
import { RequestReplyPreview } from "@/components/shared/request-reply-preview";
import { RichTextEditor } from "@/components/shared/rich-text-editor";
import { hasMeaningfulHtml } from "@/lib/message-content";
import { createEmbedTheme } from "@/theme/theme";

type ProjectStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED" | "EXPIRED";
type RequestStatus = "PENDING" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "RESOLVED" | "CLOSED";

type SessionView = {
  token: string;
  expiresAt: string;
  contact: {
    id: string;
    externalUserId: string;
    name: string;
    email: string | null;
    username: string | null;
  };
  project: { id: string; title: string; status: ProjectStatus };
  context?: { theme?: "light" | "dark" | "system"; locale?: string };
  parentOrigins: string[];
};

type RequestSummary = {
  id: string;
  number: string;
  title: string;
  description: string;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  status: RequestStatus;
  createdAt: string;
  updatedAt: string;
  category: { id: string; name: string };
  unreadCount: number;
};

type RequestListView = {
  project: { id: string; title: string; status: ProjectStatus; writable: boolean };
  categories: Array<{ id: string; name: string }>;
  requests: RequestSummary[];
};

type ApiAuthor = {
  id: string;
  type: string;
  name: string;
  email: string | null;
  image: string | null;
  source: "ACHORD" | "SUB2API" | "UNIVERSAL" | "SYSTEM";
  sourceKey?: string;
  sourceLabel?: string;
  platformRole?: string;
};

type RequestDetailView = RequestSummary & {
  writable: boolean;
  project: { id: string; title: string; status: ProjectStatus };
  messages: Array<{
    id: string;
    body: string;
    visibility: "CUSTOMER_VISIBLE";
    isSystem: boolean;
    isInitial: boolean;
    supportPlaybook?: import("@/lib/support-reply-playbooks").SupportReplyPlaybook | null;
    replyToMessageId: string | null;
    createdAt: string;
    author: ApiAuthor;
    attachments: ChatAttachment[];
    replyTo: null | {
      id: string;
      body: string;
      visibility: "CUSTOMER_VISIBLE";
      author: ApiAuthor;
      attachments: Array<{ id: string; originalName: string }>;
    };
  }>;
};

const statusLabels: Record<RequestStatus, string> = {
  PENDING: "待处理",
  IN_PROGRESS: "处理中",
  WAITING_CUSTOMER: "等待回复",
  RESOLVED: "已解决",
  CLOSED: "已关闭",
};

function createSessionId() {
  return crypto.randomUUID();
}

function normalizeLocale(value: string | undefined) {
  if (!value) return "zh-CN";
  try {
    return Intl.getCanonicalLocales(value)[0] ?? "zh-CN";
  } catch {
    return "zh-CN";
  }
}

function ExternalEmbedPortal({
  publicId,
  connector,
}: {
  publicId: string;
  connector: "SUB2API" | "UNIVERSAL";
}) {
  const connectorLabel =
    connector === "UNIVERSAL" ? "Achord Connect" : "Sub2API";
  const storageKey = `achord-${connector.toLowerCase()}-session:${publicId}`;
  const [session, setSession] = useState<SessionView | null>(null);
  const [streamReady, setStreamReady] = useState(false);
  const [list, setList] = useState<RequestListView | null>(null);
  const [detail, setDetail] = useState<RequestDetailView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ChatReplyTarget | null>(null);
  const [counterpartOnline, setCounterpartOnline] = useState(false);
  const [counterpartTyping, setCounterpartTyping] = useState(false);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const tokenRef = useRef("");
  const detailIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef(createSessionId());
  const parentOriginRef = useRef<string | null>(null);
  const prefersDarkMode = useMediaQuery("(prefers-color-scheme: dark)");
  const locale = normalizeLocale(session?.context?.locale);
  const requestedTheme = session?.context?.theme ?? "light";
  const colorMode =
    requestedTheme === "system"
      ? prefersDarkMode
        ? "dark"
        : "light"
      : requestedTheme;
  const embedTheme = useMemo(
    () => createEmbedTheme(colorMode),
    [colorMode],
  );

  useEffect(() => {
    const previous = document.documentElement.lang;
    document.documentElement.lang = locale;
    return () => {
      document.documentElement.lang = previous;
    };
  }, [locale]);

  const postParentMessage = useCallback(
    (type: "ready" | "height" | "unread-changed" | "session-expired", data: Record<string, unknown> = {}) => {
      const targetOrigin = parentOriginRef.current;
      if (!targetOrigin || window.parent === window) return;
      window.parent.postMessage(
        { source: "achord-connect-v1", type, ...data },
        targetOrigin,
      );
    },
    [],
  );

  const api = useCallback(async <T,>(path: string, init?: RequestInit) => {
    const response = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...(init?.headers ?? {}),
        Authorization: `Embed ${tokenRef.current}`,
      },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({})) as {
      data?: T;
      error?: { message?: string };
    };
    if (!response.ok || payload.data === undefined) {
      if (response.status === 401 || response.status === 403) {
        sessionStorage.removeItem(storageKey);
        postParentMessage("session-expired");
      }
      throw new Error(payload.error?.message || "请求失败");
    }
    return payload.data;
  }, [postParentMessage, storageKey]);

  const loadList = useCallback(async () => {
    const next = await api<RequestListView>("/api/v1/embed/requests");
    setList(next);
    return next;
  }, [api]);

  const loadDetail = useCallback(async (requestId: string) => {
    const next = await api<RequestDetailView>(`/api/v1/embed/requests/${requestId}`);
    setDetail(next);
    setList((current) =>
      current
        ? {
            ...current,
            requests: current.requests.map((request) =>
              request.id === requestId ? { ...request, unreadCount: 0 } : request,
            ),
          }
        : current,
    );
    detailIdRef.current = requestId;
    return next;
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        const params = new URLSearchParams(window.location.search);
        const fragment = new URLSearchParams(window.location.hash.slice(1));
        const sourceToken = params.get("token");
        const userId = params.get("user_id");
        const srcHost = params.get("src_host") ?? undefined;
        const launchTicket = fragment.get("ticket");
        window.history.replaceState({}, "", window.location.pathname);
        const parentOrigin = [
          document.referrer,
          window.location.ancestorOrigins?.[0] ?? "",
        ]
          .filter(Boolean)
          .map((value) => {
            try {
              return new URL(value).origin;
            } catch {
              return "";
            }
          })
          .find(Boolean);
        if (connector === "UNIVERSAL" && launchTicket && !parentOrigin) {
          throw new Error("无法确认 iframe 宿主来源，请返回原系统重新进入");
        }
        let nextSession: SessionView;
        if (
          (connector === "SUB2API" && sourceToken && userId) ||
          (connector === "UNIVERSAL" && launchTicket)
        ) {
          const response = await fetch(
            connector === "UNIVERSAL"
              ? "/api/v1/embed/universal/exchange"
              : "/api/v1/embed/sub2api/exchange",
            {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              connector === "UNIVERSAL"
                ? { publicId, ticket: launchTicket, parentOrigin }
                : { publicId, userId, token: sourceToken, srcHost },
            ),
            cache: "no-store",
            },
          );
          const payload = await response.json() as {
            data?: SessionView;
            error?: { message?: string };
          };
          if (!response.ok || !payload.data) {
            throw new Error(payload.error?.message || "身份验证失败");
          }
          nextSession = payload.data;
          sessionStorage.setItem(storageKey, JSON.stringify(nextSession));
        } else {
          const stored = sessionStorage.getItem(storageKey);
          if (!stored) throw new Error("请返回原系统后重新进入");
          nextSession = JSON.parse(stored) as SessionView;
        }
        if (cancelled) return;
        tokenRef.current = nextSession.token;
        const candidates = [
          document.referrer,
          window.location.ancestorOrigins?.[0] ?? "",
        ]
          .filter(Boolean)
          .map((value) => {
            try {
              return new URL(value).origin;
            } catch {
              return "";
            }
          });
        parentOriginRef.current =
          candidates.find((origin) => nextSession.parentOrigins.includes(origin)) ??
          null;
        setStreamReady(false);
        setSession(nextSession);
        // Keep loading until STREAM_READY + first list fetch finish.
      } catch (bootstrapError) {
        if (!cancelled) {
          setError(bootstrapError instanceof Error ? bootstrapError.message : "入口加载失败");
          setLoading(false);
        }
      }
    }
    void bootstrap();
    return () => { cancelled = true; };
  }, [connector, publicId, storageKey]);

  useEffect(() => {
    if (!session) return;
    const abort = new AbortController();
    const cursorKey = `${storageKey}:sse-cursor`;
    // New browser sessions start from the latest stream position (not 0) to avoid
    // replaying the contact's entire history. Resume only when we already have a cursor.
    let cursor = sessionStorage.getItem(cursorKey) || "";
    let retryMs = 1500;
    let refreshTimer: number | null = null;
    const scheduleListRefresh = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void loadList();
        if (detailIdRef.current) void loadDetail(detailIdRef.current);
      }, 120);
    };
    async function connect() {
      while (!abort.signal.aborted) {
        try {
          const response = await fetch("/api/v1/embed/stream", {
            headers: {
              Authorization: `Embed ${tokenRef.current}`,
              ...(cursor ? { "Last-Event-ID": cursor } : {}),
            },
            cache: "no-store",
            signal: abort.signal,
          });
          if (response.status === 401 || response.status === 403) {
            sessionStorage.removeItem(storageKey);
            sessionStorage.removeItem(cursorKey);
            tokenRef.current = "";
            setStreamReady(false);
            setSession(null);
            setLoading(false);
            setError("会话已失效，请返回原系统后重新进入");
            postParentMessage("session-expired");
            return;
          }
          if (!response.ok || !response.body) throw new Error("实时连接失败");
          retryMs = 1500;
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (!abort.signal.aborted) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const frames = buffer.split("\n\n");
            buffer = frames.pop() ?? "";
            for (const frame of frames) {
              let eventType = "message";
              let data = "";
              for (const line of frame.split("\n")) {
                if (line.startsWith("id:")) {
                  cursor = line.slice(3).trim();
                  sessionStorage.setItem(cursorKey, cursor);
                }
                if (line.startsWith("event:")) eventType = line.slice(6).trim();
                if (line.startsWith("data:")) data += line.slice(5).trim();
              }
              if (eventType === "STREAM_READY") {
                if (data) {
                  try {
                    const ready = JSON.parse(data) as { eventId?: string };
                    if (ready.eventId && /^\d+$/.test(ready.eventId)) {
                      cursor = ready.eventId;
                      sessionStorage.setItem(cursorKey, cursor);
                    }
                  } catch {
                    // ignore malformed ready payload
                  }
                }
                setStreamReady(true);
                continue;
              }
              if (!data) continue;
              const payload = JSON.parse(data) as Record<string, unknown>;
              const requestId = String(payload.requestId ?? payload.serviceRequestId ?? "");
              if (eventType === "REQUEST_TYPING_CHANGED" && requestId === detailIdRef.current) {
                setCounterpartTyping(payload.typing === true);
                continue;
              }
              if (eventType === "REQUEST_PRESENCE_CHANGED" && requestId === detailIdRef.current && payload.group === "STAFF") {
                setCounterpartOnline(payload.online === true);
                continue;
              }
              if (eventType.startsWith("REQUEST_")) scheduleListRefresh();
            }
          }
          // Server closed the stream cleanly; wait before reconnecting.
          if (!abort.signal.aborted) {
            await new Promise((resolve) => setTimeout(resolve, retryMs));
          }
        } catch {
          if (!abort.signal.aborted) {
            await new Promise((resolve) => setTimeout(resolve, retryMs));
            retryMs = Math.min(retryMs * 2, 15_000);
          }
        }
      }
    }
    void connect();
    return () => {
      abort.abort();
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      // Defer so unmount cleanup does not trip set-state-in-effect lint.
      queueMicrotask(() => setStreamReady(false));
    };
  }, [loadDetail, loadList, postParentMessage, session, storageKey]);

  useEffect(() => {
    if (!session) return;
    postParentMessage("ready");
    const observer = new ResizeObserver(() => {
      postParentMessage("height", {
        height: Math.ceil(document.documentElement.scrollHeight),
      });
    });
    observer.observe(document.documentElement);
    return () => observer.disconnect();
  }, [postParentMessage, session]);

  const totalUnread = useMemo(
    () => list?.requests.reduce((sum, request) => sum + request.unreadCount, 0) ?? 0,
    [list],
  );
  useEffect(() => {
    if (!session || !list) return;
    postParentMessage("unread-changed", { unreadCount: totalUnread });
  }, [list, postParentMessage, session, totalUnread]);

  useEffect(() => {
    if (!session || !streamReady) return;
    let cancelled = false;
    void (async () => {
      try {
        await loadList();
      } catch (listError) {
        if (!cancelled) {
          setError(listError instanceof Error ? listError.message : "工单列表加载失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadList, session, streamReady]);

  useEffect(() => {
    let cancelled = false;
    const images = (detail?.messages ?? [])
      .flatMap((message) => message.attachments)
      .filter((file) => file.mimeType.startsWith("image/"));
    const imageIds = new Set(images.map((file) => file.id));

    async function loadImages() {
      // Reconcile blob URLs after paint so lint does not treat this as sync setState-in-effect.
      await Promise.resolve();
      if (cancelled) return;

      let missing: typeof images = images;
      setAttachmentUrls((previous) => {
        const next: Record<string, string> = {};
        for (const [id, url] of Object.entries(previous)) {
          if (imageIds.has(id)) next[id] = url;
          else URL.revokeObjectURL(url);
        }
        missing = images.filter((file) => !next[file.id]);
        return next;
      });
      if (cancelled || missing.length === 0) return;

      const entries = await Promise.all(
        missing.map(async (file) => {
          const response = await fetch(
            `/api/v1/embed/attachments/${file.id}?disposition=inline`,
            {
              headers: { Authorization: `Embed ${tokenRef.current}` },
              cache: "no-store",
            },
          );
          if (!response.ok) return null;
          return [file.id, URL.createObjectURL(await response.blob())] as const;
        }),
      );
      if (cancelled) {
        for (const entry of entries) {
          if (entry) URL.revokeObjectURL(entry[1]);
        }
        return;
      }
      setAttachmentUrls((previous) => {
        const next = { ...previous };
        for (const entry of entries) {
          if (!entry) continue;
          if (previous[entry[0]]) {
            URL.revokeObjectURL(entry[1]);
            continue;
          }
          next[entry[0]] = entry[1];
        }
        return next;
      });
    }

    void loadImages();
    return () => {
      cancelled = true;
    };
  }, [detail]);

  const detailRequestId = detail?.id ?? null;
  useEffect(() => {
    if (!detailRequestId) return;
    const requestId = detailRequestId;
    const report = (action: "heartbeat" | "leave", keepalive = false) => fetch(
      `/api/v1/embed/requests/${requestId}/presence`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Embed ${tokenRef.current}`,
        },
        body: JSON.stringify({ action, sessionId: sessionIdRef.current }),
        keepalive,
      },
    ).then(async (response) => {
      if (action === "heartbeat" && response.ok) {
        const payload = await response.json() as { data?: { counterpartOnline?: boolean } };
        setCounterpartOnline(payload.data?.counterpartOnline === true);
      }
    }).catch(() => undefined);
    const refreshHeartbeat = () => void report("heartbeat");
    const handlePageHide = () => void report("leave", true);
    void report("heartbeat");
    const timer = window.setInterval(refreshHeartbeat, 30_000);
    document.addEventListener("visibilitychange", refreshHeartbeat);
    window.addEventListener("focus", refreshHeartbeat);
    window.addEventListener("pageshow", refreshHeartbeat);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshHeartbeat);
      window.removeEventListener("focus", refreshHeartbeat);
      window.removeEventListener("pageshow", refreshHeartbeat);
      window.removeEventListener("pagehide", handlePageHide);
      void report("leave", true);
    };
  }, [detailRequestId]);

  async function downloadAttachment(file: ChatAttachment) {
    const response = await fetch(`/api/v1/embed/attachments/${file.id}`, {
      headers: { Authorization: `Embed ${tokenRef.current}` },
    });
    if (!response.ok) return;
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = file.originalName;
    link.click();
    URL.revokeObjectURL(url);
  }

  const messages = useMemo<ChatMessage[]>(() => detail?.messages.map((message) => ({
    id: message.id,
    body: message.body,
    authorId: message.author.id,
    authorName: message.author.name,
    authorImage: message.author.image,
    authorPlatformRole: message.author.platformRole,
    authorSource: message.author.source,
    authorSourceKey: message.author.sourceKey,
    authorSourceLabel: message.author.sourceLabel,
    createdAt: message.createdAt,
    isSystem: message.isSystem,
    isInitial: message.isInitial,
    supportPlaybook: message.supportPlaybook,
    visibility: message.visibility,
    replyToMessageId: message.replyToMessageId,
    replyTo: message.replyTo ? {
      id: message.replyTo.id,
      body: message.replyTo.body,
      authorId: message.replyTo.author.id,
      authorName: message.replyTo.author.name,
      visibility: message.replyTo.visibility,
      attachments: message.replyTo.attachments,
    } : null,
    attachments: message.attachments,
  })) ?? [], [detail]);

  if (loading) {
    return (
      <ThemeProvider theme={embedTheme}>
        <LinearProgress />
      </ThemeProvider>
    );
  }
  if (error || !session || !list) {
    return (
      <ThemeProvider theme={embedTheme}>
        <Container maxWidth="sm" sx={{ py: 6 }}>
          <Alert severity="error">{error || "请返回原系统后重新进入"}</Alert>
        </Container>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={embedTheme}>
    <Box
      data-testid="external-embed-shell"
      sx={{ minHeight: "100dvh", bgcolor: "background.default" }}
    >
      <AppBar position="sticky" elevation={0} color="inherit" sx={{ borderBottom: "1px solid", borderColor: "divider" }}>
        <Toolbar sx={{ gap: 1.5 }}>
          {detail ? (
            <Tooltip title="返回工单列表">
              <IconButton onClick={() => { setDetail(null); detailIdRef.current = null; setReplyTarget(null); }}>
                <ArrowBackOutlinedIcon />
              </IconButton>
            </Tooltip>
          ) : null}
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontWeight: 750 }} noWrap>{list.project.title}</Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {session.contact.name} · {connectorLabel}
            </Typography>
          </Box>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ py: { xs: 2, md: 3 }, px: { xs: 1.5, sm: 3 } }}>
        {detail ? (
          <Stack spacing={2}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ justifyContent: "space-between" }}>
              <Box>
                <Typography variant="h5" sx={{ fontWeight: 750 }}>{detail.title}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {detail.number} · {detail.category.name}
                </Typography>
              </Box>
              <Stack direction="row" spacing={1} sx={{ alignSelf: { xs: "flex-start", sm: "center" }, alignItems: "center" }}>
                <Chip label={statusLabels[detail.status]} />
                {detail.status === "RESOLVED" && detail.writable ? (
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => {
                      void api(`/api/v1/embed/requests/${detail.id}/close`, { method: "POST" })
                        .then(() => loadDetail(detail.id))
                        .then(() => loadList())
                        .catch((closeError) => {
                          setError(closeError instanceof Error ? closeError.message : "关闭失败");
                        });
                    }}
                  >
                    确认关闭
                  </Button>
                ) : null}
              </Stack>
            </Stack>
            <RequestChatHeading counterpartOnline={counterpartOnline} counterpartLabel="服务人员" />
            <RequestChatThread
              messages={messages}
              currentUserId={session.contact.id}
              onReply={detail.writable ? setReplyTarget : undefined}
              counterpartTypingLabel={counterpartTyping ? "服务人员" : null}
              attachmentUrl={(file) => attachmentUrls[file.id] || "about:blank"}
              onAttachmentDownload={downloadAttachment}
              locale={locale}
            />
            {detail.writable ? (
              <EmbedReplyComposer
                requestId={detail.id}
                token={session.token}
                replyTarget={replyTarget}
                onCancelReply={() => setReplyTarget(null)}
                onSent={() => loadDetail(detail.id)}
                onTyping={(typing) => {
                  const store = (window as unknown as {
                    __achordTyping?: Record<string, { active: boolean; sentAt: number }>;
                  }).__achordTyping ?? {};
                  (window as unknown as {
                    __achordTyping?: Record<string, { active: boolean; sentAt: number }>;
                  }).__achordTyping = store;
                  const key = `typing:${detail.id}`;
                  const now = Date.now();
                  const current = store[key];
                  const shouldSend =
                    !current ||
                    current.active !== typing ||
                    (typing && now - current.sentAt >= 8_000);
                  if (!shouldSend) return;
                  store[key] = { active: typing, sentAt: now };
                  void api(`/api/v1/embed/requests/${detail.id}/presence`, {
                    method: "POST",
                    body: JSON.stringify({ action: "typing", sessionId: sessionIdRef.current, typing }),
                  }).catch(() => undefined);
                }}
              />
            ) : (
              <Alert severity="info">当前项目或工单只允许查看历史内容。</Alert>
            )}
          </Stack>
        ) : (
          <Stack spacing={1.5}>
            {list.project.writable ? (
              <Box sx={{ display: "flex", justifyContent: "flex-start" }}>
                <Button
                  variant="contained"
                  startIcon={<AddOutlinedIcon />}
                  onClick={() => setCreateOpen(true)}
                  sx={{ width: { xs: "100%", sm: "auto" } }}
                >
                  新建工单
                </Button>
              </Box>
            ) : null}
            {!list.project.writable ? <Alert severity="info">当前项目只允许查看历史工单。</Alert> : null}
            {list.requests.map((request) => (
              <Paper
                key={request.id}
                component="button"
                type="button"
                variant="outlined"
                onClick={() => void loadDetail(request.id)}
                sx={{ p: 2, textAlign: "left", cursor: "pointer", width: "100%", bgcolor: "background.paper" }}
              >
                <Stack direction="row" spacing={1.5} sx={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Badge
                      color="error"
                      badgeContent={request.unreadCount}
                      invisible={request.unreadCount === 0}
                      max={99}
                      sx={{ maxWidth: "100%" }}
                    >
                      <Typography sx={{ fontWeight: 700, pr: request.unreadCount ? 2 : 0 }} noWrap>
                        {request.title}
                      </Typography>
                    </Badge>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      {request.number} · {request.category.name}
                    </Typography>
                  </Box>
                  <Chip size="small" label={statusLabels[request.status]} />
                </Stack>
              </Paper>
            ))}
            {list.requests.length === 0 ? <Alert severity="info">暂无工单。</Alert> : null}
          </Stack>
        )}
      </Container>
      <CreateRequestDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        categories={list.categories}
        token={session.token}
        onCreated={async (requestId, options) => {
          await loadList();
          await loadDetail(requestId);
          if (!options?.keepOpen) setCreateOpen(false);
        }}
      />
    </Box>
    </ThemeProvider>
  );
}

export function Sub2ApiEmbedPortal({ publicId }: { publicId: string }) {
  return <ExternalEmbedPortal publicId={publicId} connector="SUB2API" />;
}

export function UniversalEmbedPortal({ publicId }: { publicId: string }) {
  return <ExternalEmbedPortal publicId={publicId} connector="UNIVERSAL" />;
}

function EmbedReplyComposer({
  requestId,
  token,
  replyTarget,
  onCancelReply,
  onSent,
  onTyping,
}: {
  requestId: string;
  token: string;
  replyTarget: ChatReplyTarget | null;
  onCancelReply: () => void;
  onSent: () => Promise<unknown>;
  onTyping: (typing: boolean) => void;
}) {
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [inlineImageUploading, setInlineImageUploading] = useState(false);
  const typingTimer = useRef<number | null>(null);
  const uploadInlineImage = useCallback(
    async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      form.append("serviceRequestId", requestId);
      form.append("inline", "true");
      const response = await fetch("/api/v1/embed/attachments", {
        method: "POST",
        headers: { Authorization: `Embed ${token}` },
        body: form,
      });
      const payload = (await response.json()) as {
        data?: { id?: string };
        error?: { message?: string };
      };
      if (!response.ok || !payload.data?.id) {
        throw new Error(payload.error?.message || "图片上传失败");
      }
      return { attachmentId: payload.data.id };
    },
    [requestId, token],
  );
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!hasMeaningfulHtml(body) && files.length === 0) return;
    setSending(true);
    setError("");
    onTyping(false);
    try {
      const response = await fetch(`/api/v1/embed/requests/${requestId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Embed ${token}` },
        body: JSON.stringify({
          body: hasMeaningfulHtml(body) ? body : `附件：${files.map((file) => file.name).join("、")}`,
          replyToMessageId: replyTarget?.id,
        }),
      });
      const payload = await response.json() as { data?: { message?: { id?: string } }; error?: { message?: string } };
      if (!response.ok || !payload.data?.message?.id) throw new Error(payload.error?.message || "回复发送失败");
      const failedUploads: string[] = [];
      for (const file of files) {
        const form = new FormData();
        form.append("file", file);
        form.append("serviceRequestId", requestId);
        form.append("requestMessageId", payload.data.message.id);
        const upload = await fetch("/api/v1/embed/attachments", {
          method: "POST",
          headers: { Authorization: `Embed ${token}` },
          body: form,
        });
        if (!upload.ok) failedUploads.push(file.name);
      }
      setBody("");
      setFiles([]);
      onCancelReply();
      await onSent();
      if (failedUploads.length > 0) {
        throw new Error(`消息已发送，但附件上传失败：${failedUploads.join("、")}`);
      }
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "回复发送失败");
    } finally {
      setSending(false);
    }
  }
  return (
    <Paper component="form" variant="outlined" onSubmit={submit} sx={{ overflow: "hidden" }}>
      {sending ? <LinearProgress /> : null}
      <Stack spacing={1.5} sx={{ p: 2 }}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {replyTarget ? <RequestReplyPreview target={replyTarget} onCancel={onCancelReply} /> : null}
        <RichTextEditor
          value={body}
          onChange={(value) => {
            setBody(value);
            onTyping(hasMeaningfulHtml(value));
            if (typingTimer.current) window.clearTimeout(typingTimer.current);
            typingTimer.current = window.setTimeout(() => onTyping(false), 2200);
          }}
          disabled={sending}
          uploadImage={uploadInlineImage}
          onImageUploadingChange={setInlineImageUploading}
          placeholder="回复服务人员"
        />
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ justifyContent: "space-between" }}>
          <Button component="label" variant="outlined" startIcon={<AttachFileOutlinedIcon />} disabled={sending}>
            添加附件
            <input hidden type="file" multiple onChange={(event) => { setFiles((current) => [...current, ...Array.from(event.target.files ?? [])]); event.target.value = ""; }} />
          </Button>
          <Button type="submit" variant="contained" endIcon={<SendOutlinedIcon />} disabled={sending || inlineImageUploading || (!hasMeaningfulHtml(body) && files.length === 0)}>
            发送
          </Button>
        </Stack>
        <RequestAttachmentDrafts files={files} onRemove={(index) => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} />
      </Stack>
    </Paper>
  );
}

function CreateRequestDialog({
  open,
  onClose,
  categories,
  token,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  categories: Array<{ id: string; name: string }>;
  token: string;
  onCreated: (
    requestId: string,
    options?: { keepOpen?: boolean },
  ) => Promise<void>;
}) {
  const [fileDrafts, setFileDrafts] = useState<Array<{ key: string; file: File }>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [createdRequest, setCreatedRequest] = useState<{
    id: string;
    initialMessageId: string;
  } | null>(null);
  const draftKeyRef = useRef(0);
  function resetDialogState() {
    setFileDrafts([]);
    setError("");
    setCreatedRequest(null);
    setSaving(false);
  }
  function handleClose() {
    if (saving) return;
    resetDialogState();
    onClose();
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      let requestId = createdRequest?.id;
      let initialMessageId = createdRequest?.initialMessageId;
      if (!requestId || !initialMessageId) {
        const response = await fetch("/api/v1/embed/requests", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Embed ${token}` },
          body: JSON.stringify({
            title: String(form.get("title") ?? "").trim(),
            description: String(form.get("description") ?? "").trim(),
            categoryId: String(form.get("categoryId") ?? ""),
            priority: String(form.get("priority") ?? "NORMAL"),
          }),
        });
        const payload = await response.json() as { data?: { id: string; initialMessageId: string }; error?: { message?: string } };
        if (!response.ok || !payload.data) throw new Error(payload.error?.message || "工单创建失败");
        requestId = payload.data.id;
        initialMessageId = payload.data.initialMessageId;
        setCreatedRequest({ id: requestId, initialMessageId });
      }
      // Track drafts by unique key so same-name files and partial failures do not
      // re-upload successful ones. Network errors count as failed drafts, not as
      // "create failed", once the request id already exists.
      const pendingDrafts = [...fileDrafts];
      const failedDrafts: Array<{ key: string; file: File }> = [];
      for (const draft of pendingDrafts) {
        try {
          const uploadForm = new FormData();
          uploadForm.append("file", draft.file);
          uploadForm.append("serviceRequestId", requestId);
          uploadForm.append("requestMessageId", initialMessageId);
          const upload = await fetch("/api/v1/embed/attachments", {
            method: "POST",
            headers: { Authorization: `Embed ${token}` },
            body: uploadForm,
          });
          if (upload.ok) {
            setFileDrafts((current) => current.filter((item) => item.key !== draft.key));
          } else {
            failedDrafts.push(draft);
          }
        } catch {
          failedDrafts.push(draft);
        }
      }
      if (failedDrafts.length > 0) {
        setFileDrafts(failedDrafts);
        try {
          await onCreated(requestId, { keepOpen: true });
        } catch {
          // Parent refresh failure must not forget the created request id.
        }
        setError(
          `工单已创建，但附件上传失败：${failedDrafts.map((item) => item.file.name).join("、")}。请重试剩余附件，或关闭后到工单详情补传。`,
        );
        return;
      }
      // All uploads succeeded. Clear local files immediately so a later refresh
      // failure cannot re-upload them; keep createdRequest until parent adopts it.
      setFileDrafts([]);
      try {
        await onCreated(requestId);
        resetDialogState();
      } catch (refreshError) {
        setError(
          refreshError instanceof Error
            ? `工单已创建，但页面刷新失败：${refreshError.message}`
            : "工单已创建，但页面刷新失败",
        );
      }
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "工单创建失败");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open={open} onClose={saving ? undefined : handleClose} fullWidth maxWidth="sm">
      <Box component="form" onSubmit={submit}>
        {saving ? <LinearProgress /> : null}
        <DialogTitle>
          <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
            新建工单
            <IconButton onClick={handleClose} disabled={saving}><CloseOutlinedIcon /></IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            {createdRequest ? (
              <Alert severity="info">
                工单已创建。当前只会重试失败附件，不会再次创建新工单。
              </Alert>
            ) : null}
            <TextField name="title" label="标题" required fullWidth disabled={Boolean(createdRequest) || saving} />
            <TextField name="categoryId" label="分类" select required defaultValue="" fullWidth disabled={Boolean(createdRequest) || saving}>
              {categories.map((category) => <MenuItem key={category.id} value={category.id}>{category.name}</MenuItem>)}
            </TextField>
            <TextField name="priority" label="优先级" select defaultValue="NORMAL" fullWidth disabled={Boolean(createdRequest) || saving}>
              <MenuItem value="LOW">低</MenuItem>
              <MenuItem value="NORMAL">普通</MenuItem>
              <MenuItem value="HIGH">高</MenuItem>
              <MenuItem value="URGENT">紧急</MenuItem>
            </TextField>
            <TextField name="description" label="问题详情" multiline minRows={5} required fullWidth disabled={Boolean(createdRequest) || saving} />
            <Button component="label" variant="outlined" startIcon={<AttachFileOutlinedIcon />} disabled={saving}>
              添加附件
              <input
                hidden
                type="file"
                multiple
                onChange={(event) => {
                  const selected = Array.from(event.target.files ?? []);
                  if (selected.length > 0) {
                    setFileDrafts((current) => [
                      ...current,
                      ...selected.map((file) => {
                        draftKeyRef.current += 1;
                        return { key: `draft-${draftKeyRef.current}`, file };
                      }),
                    ]);
                  }
                  event.target.value = "";
                }}
              />
            </Button>
            <RequestAttachmentDrafts
              files={fileDrafts.map((item) => item.file)}
              onRemove={(index) =>
                setFileDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index))
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={handleClose} disabled={saving}>取消</Button>
          <Button type="submit" variant="contained" disabled={saving}>
            {createdRequest ? (fileDrafts.length > 0 ? "重试附件" : "关闭并查看") : "创建"}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
