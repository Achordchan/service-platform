"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";
import QrCode2OutlinedIcon from "@mui/icons-material/QrCode2Outlined";
import SmartphoneOutlinedIcon from "@mui/icons-material/SmartphoneOutlined";

type QrState =
  | { phase: "loading" }
  | {
      phase: "ready";
      ticketId: string;
      token: string;
      expiresAt: Date;
    }
  | { phase: "unavailable" }
  | { phase: "expired" }
  | { phase: "success" };

const POLL_INTERVAL_MS = 2500;

/**
 * 网页版扫码登录（唯一通道：小程序码）。
 * 微信扫一扫 / 长按识别二维码 → 直达小程序确认页；确认后服务端签发会话并跳转。
 * 小程序未发布或未配置正式凭据时展示占位说明。
 */
export function QrLoginPanel({ redirectTo }: { redirectTo?: string }) {
  const [state, setState] = useState<QrState>({ phase: "loading" });
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fallbackDoneRef = useRef(false);
  const redirectToRef = useRef(redirectTo);
  // pollStatus 在 startLogin 之后声明，轮询回调经 ref 间接访问避免引用先于声明
  const pollStatusRef = useRef<(ticketId: string, token: string) => void>(() => undefined);
  // 代际计数：组件卸载/重开时使「在途的异步 startLogin」作废，
  // 防止其 resolve 后创建无人清理的轮询 interval（曾导致多实例泄漏刷屏）
  const generationRef = useRef(0);

  const stopPolling = useCallback(() => {
    generationRef.current += 1;
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const startLogin = useCallback(async () => {
    stopPolling();
    const generation = generationRef.current;
    fallbackDoneRef.current = false;
    // 注意：首个 await 前不得 setState（effect 会直接调用本函数，
    // react-hooks/set-state-in-effect 禁止 effect 体内同步 setState）
    try {
      const response = await fetch("/api/web-login/qr", { method: "POST" });
      const body = (await response.json()) as {
        data?: { ticketId: string; token: string; expiresAt: string };
        error?: { message?: string };
      };
      if (generation !== generationRef.current) return;
      if (!response.ok || !body.data) {
        throw new Error(body.error?.message ?? "二维码创建失败");
      }
      setState({
        phase: "ready",
        ticketId: body.data.ticketId,
        token: body.data.token,
        expiresAt: new Date(body.data.expiresAt),
      });
      pollingRef.current = setInterval(() => {
        // 页面不可见（切走标签页/锁屏）时暂停轮询，回来自动恢复
        if (document.visibilityState !== "visible") return;
        pollStatusRef.current(body.data!.ticketId, body.data!.token);
      }, POLL_INTERVAL_MS);
    } catch (caught) {
      if (generation !== generationRef.current) return;
      setError(caught instanceof Error ? caught.message : "二维码创建失败");
      setState({ phase: "expired" });
    }
  }, [stopPolling]);

  const pollStatus = useCallback(
    async (ticketId: string, token: string) => {
      try {
        const response = await fetch(
          `/api/web-login/qr/${ticketId}?token=${encodeURIComponent(token)}`,
        );
        const body = (await response.json()) as {
          data?: { status?: string };
        };
        const status = body.data?.status;
        if (status === "LOGGED_IN") {
          stopPolling();
          setState({ phase: "success" });
          window.location.href = redirectToRef.current || "/customer/projects";
          return;
        }
        if (status === "EXPIRED") {
          stopPolling();
          setState({ phase: "expired" });
        }
      } catch {
        // 网络抖动继续轮询，直到超时
      }
    },
    [stopPolling],
  );

  useEffect(() => {
    pollStatusRef.current = (ticketId: string, token: string) => {
      void pollStatus(ticketId, token);
    };
  }, [pollStatus]);

  useEffect(() => {
    // 经由定时器回调启动（而非 effect 体内直接调用）：
    // startLogin 含状态写入，直接调用会触发 set-state-in-effect 级联渲染
    const kickoff = setTimeout(() => void startLogin(), 0);
    return () => {
      clearTimeout(kickoff);
      stopPolling();
    };
  }, [startLogin, stopPolling]);

  // 到期自动置为过期
  useEffect(() => {
    if (state.phase !== "ready") return;
    const remain = state.expiresAt.getTime() - Date.now();
    const timer = setTimeout(() => {
      stopPolling();
      setState((prev) => (prev.phase === "ready" ? { phase: "expired" } : prev));
    }, Math.max(remain, 0));
    return () => clearTimeout(timer);
  }, [state, stopPolling]);

  if (state.phase === "success") {
    return (
      <Stack spacing={2} sx={{ alignItems: "center", py: 6 }}>
        <QrCode2OutlinedIcon color="primary" sx={{ fontSize: 44 }} />
        <Typography sx={{ fontWeight: 650 }}>登录成功，正在进入…</Typography>
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Stack
        sx={{
          alignItems: "center",
          py: 3,
          minHeight: 280,
          justifyContent: "center",
        }}
      >
        {state.phase === "ready" ? (
          <Box
            component="img"
            src={`/api/web-login/qr/${state.ticketId}/wxacode?token=${encodeURIComponent(state.token)}`}
            alt="登录小程序码"
            onError={() => {
              // 小程序码不可用（未发布/未配置正式凭据）：发布前占位
              if (fallbackDoneRef.current) return;
              fallbackDoneRef.current = true;
              stopPolling();
              setState({ phase: "unavailable" });
            }}
            sx={{
              width: 232,
              height: 232,
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 2,
            }}
          />
        ) : state.phase === "unavailable" ? (
          <Stack
            spacing={1.5}
            sx={{
              alignItems: "center",
              justifyContent: "center",
              width: 232,
              height: 232,
              border: "1px dashed",
              borderColor: "divider",
              borderRadius: 2,
              px: 3,
            }}
          >
            <QrCode2OutlinedIcon sx={{ color: "text.disabled", fontSize: 34 }} />
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
              小程序码将在小程序正式发布并配置微信凭据后开放
            </Typography>
          </Stack>
        ) : state.phase === "expired" ? (
          <Stack
            spacing={1.5}
            sx={{
              alignItems: "center",
              justifyContent: "center",
              width: 232,
              height: 232,
              border: "1px dashed",
              borderColor: "divider",
              borderRadius: 2,
            }}
          >
            <Typography color="text.secondary">二维码已过期</Typography>
            <Button
              size="small"
              startIcon={<RefreshOutlinedIcon />}
              onClick={() => {
                setState({ phase: "loading" });
                setError(null);
                void startLogin();
              }}
            >
              刷新二维码
            </Button>
          </Stack>
        ) : (
          <Box sx={{ width: 232, height: 232 }} />
        )}
      </Stack>

      <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
        <SmartphoneOutlinedIcon
          fontSize="small"
          sx={{ mt: "2px", color: "text.secondary" }}
        />
        <Typography variant="body2" color="text.secondary">
          使用微信「扫一扫」或长按识别二维码，在小程序中确认后即可登录。二维码 5
          分钟内有效。
        </Typography>
      </Stack>
    </Stack>
  );
}
