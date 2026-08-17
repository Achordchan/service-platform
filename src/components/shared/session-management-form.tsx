"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Paper,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  ComputerRounded,
  PhoneAndroidRounded,
  TabletRounded,
  DevicesOtherRounded,
  LogoutRounded,
  RefreshRounded,
} from "@mui/icons-material";
import { authClient } from "@/lib/auth-client";
import { useToast } from "@/components/shared/toast-provider";

type SessionInfo = {
  id: string;
  token: string;
  createdAt: Date;
  expiresAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
};

function parseUserAgent(ua?: string | null) {
  if (!ua)
    return {
      device: "未知设备",
      browser: "未知浏览器",
      type: "other" as const,
    };

  const isMobile = /Mobile|Android|iPhone|iPod/i.test(ua);
  const isTablet = /iPad|Tablet|PlayBook/i.test(ua);

  let browser = "未知浏览器";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = "Chrome";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = "Safari";
  else if (/Opera|OPR\//i.test(ua)) browser = "Opera";

  let os = "";
  if (/Windows/i.test(ua)) os = "Windows";
  else if (/Mac OS X|macOS/i.test(ua)) os = "macOS";
  else if (/Linux/i.test(ua) && !isMobile) os = "Linux";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";

  const device = os || "未知设备";
  const type = isTablet
    ? ("tablet" as const)
    : isMobile
      ? ("mobile" as const)
      : ("desktop" as const);

  return { device, browser, type };
}

function DeviceIcon({
  type,
}: {
  type: "desktop" | "mobile" | "tablet" | "other";
}) {
  const sx = { fontSize: 28, color: "text.secondary" };
  if (type === "mobile") return <PhoneAndroidRounded sx={sx} />;
  if (type === "tablet") return <TabletRounded sx={sx} />;
  if (type === "desktop") return <ComputerRounded sx={sx} />;
  return <DevicesOtherRounded sx={sx} />;
}

function formatTime(date: Date) {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay} 天前`;
  return d.toLocaleDateString("zh-CN");
}

export function SessionManagementForm() {
  const toast = useToast();
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [currentToken, setCurrentToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revokingToken, setRevokingToken] = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [sessionsResult, currentResult] = await Promise.all([
      authClient.listSessions(),
      authClient.getSession(),
    ]);
    if (sessionsResult.error) {
      setError(sessionsResult.error.message || "获取会话列表失败");
      setLoading(false);
      return;
    }
    const activeToken = currentResult.data?.session?.token ?? null;
    setCurrentToken(activeToken);
    const sorted = [...(sessionsResult.data ?? [])].sort((a, b) => {
      if (activeToken) {
        if (a.token === activeToken) return -1;
        if (b.token === activeToken) return 1;
      }
      return (
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    });
    setSessions(sorted);
    setLoading(false);
  }, []);

  useEffect(() => {
    // 初始数据加载：fetchSessions 首个 await 前的 setLoading 属于请求路径必需的同步重置
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchSessions();
  }, [fetchSessions]);

  async function revokeOne(token: string) {
    setRevokingToken(token);
    const result = await authClient.revokeSession({ token });
    setRevokingToken(null);
    if (result.error) {
      toast.error(result.error.message || "注销会话失败");
      return;
    }
    toast.success("会话已注销");
    setSessions((prev) => prev?.filter((s) => s.token !== token) ?? null);
  }

  async function revokeOthers() {
    setRevokingAll(true);
    const result = await authClient.revokeSessions();
    setRevokingAll(false);
    if (result.error) {
      toast.error(result.error.message || "注销会话失败");
      return;
    }
    toast.success("其他会话已全部注销");
    setSessions((prev) =>
      prev?.filter((s) => s.token === currentToken) ?? null,
    );
  }

  const otherSessions = sessions?.filter((s) => s.token !== currentToken);

  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
      <Stack spacing={2}>
        <Stack
          direction="row"
          sx={{ alignItems: "center", justifyContent: "space-between" }}
        >
          <div>
            <Typography sx={{ fontWeight: 650 }}>登录会话</Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mt: 0.5 }}
            >
              管理当前已登录的设备和浏览器，可注销不再使用的会话。
            </Typography>
          </div>
          <Tooltip title="刷新">
            <IconButton
              size="small"
              onClick={() => void fetchSessions()}
              disabled={loading}
            >
              <RefreshRounded fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>

        {error && <Alert severity="error">{error}</Alert>}

        {loading && !sessions ? (
          <Stack spacing={1.5}>
            {[0, 1].map((i) => (
              <Skeleton
                key={i}
                variant="rounded"
                height={72}
                sx={{ borderRadius: 1 }}
              />
            ))}
          </Stack>
        ) : sessions && sessions.length > 0 ? (
          <Stack spacing={1}>
            {sessions.map((session) => {
              const isCurrent = session.token === currentToken;
              const parsed = parseUserAgent(session.userAgent);
              return (
                <Box
                  key={session.id}
                  sx={(theme) => ({
                    display: "flex",
                    alignItems: "center",
                    gap: 2,
                    p: 2,
                    borderRadius: 1,
                    border: "1px solid",
                    borderColor: isCurrent ? "primary.main" : "divider",
                    bgcolor: isCurrent ? "action.hover" : "transparent",
                    ...theme.applyStyles("dark", {
                      bgcolor: isCurrent ? "action.hover" : "transparent",
                    }),
                  })}
                >
                  <DeviceIcon type={parsed.type} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: "center", flexWrap: "wrap" }}
                    >
                      <Typography variant="body2" sx={{ fontWeight: 650 }}>
                        {parsed.browser} · {parsed.device}
                      </Typography>
                      {isCurrent && (
                        <Chip
                          label="当前会话"
                          size="small"
                          color="primary"
                          variant="outlined"
                          sx={{ height: 20, fontSize: 11 }}
                        />
                      )}
                    </Stack>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block", mt: 0.25 }}
                    >
                      {session.ipAddress ?? "IP 未知"} · 登录于{" "}
                      {formatTime(session.createdAt)}
                    </Typography>
                  </Box>
                  {!isCurrent && (
                    <Tooltip title="注销此会话">
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => void revokeOne(session.token)}
                        disabled={revokingToken === session.token}
                      >
                        <LogoutRounded fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
              );
            })}
          </Stack>
        ) : null}

        {otherSessions && otherSessions.length > 0 && (
          <Button
            variant="outlined"
            color="error"
            size="small"
            onClick={() => void revokeOthers()}
            disabled={revokingAll}
            sx={{ alignSelf: { xs: "stretch", sm: "flex-start" } }}
          >
            {revokingAll ? "注销中…" : "注销所有其他会话"}
          </Button>
        )}
      </Stack>
    </Paper>
  );
}
