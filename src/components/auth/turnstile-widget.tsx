"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
          language?: string;
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

/**
 * Cloudflare Turnstile 人机验证组件。
 * siteKey 未配置时渲染 null（服务端同步跳过校验，本地最小配置可登录）；
 * 官方测试密钥与正式密钥行为一致（测试件永远通过）。
 *
 * token 一次性：父组件在每次提交前递增 resetSignal，组件据此重置挑战，
 * onToken 会随新挑战再次回调（无 token 时提交会被服务端拒绝）。
 */
export function TurnstileWidget({
  siteKey,
  resetSignal,
  onToken,
  onError,
}: {
  siteKey: string | null;
  resetSignal: number;
  onToken: (token: string) => void;
  onError?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const onTokenRef = useRef(onToken);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onTokenRef.current = onToken;
    onErrorRef.current = onError;
  }, [onToken, onError]);

  // 0 为初始值（组件刚挂载不需要 reset）；每次提交后父组件递增触发重置
  useEffect(() => {
    if (resetSignal === 0) return;
    if (widgetIdRef.current !== null && window.turnstile) {
      try {
        window.turnstile.reset(widgetIdRef.current);
      } catch {
        // 重置失败时忽略，expired-callback 会兜底
      }
    }
  }, [resetSignal]);

  const render = useCallback(() => {
    if (!siteKey || !containerRef.current || !window.turnstile) return;
    if (widgetIdRef.current !== null) return;
    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      callback: (token) => onTokenRef.current(token),
      "error-callback": () => onErrorRef.current?.(),
      "expired-callback": () => onErrorRef.current?.(),
      theme: "light",
      language: "zh-cn",
    });
  }, [siteKey]);

  useEffect(() => {
    render();
    return () => {
      if (widgetIdRef.current !== null && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // 组件已卸载，忽略
        }
        widgetIdRef.current = null;
      }
    };
  }, [render, scriptReady]);

  if (!siteKey) return null;

  return (
    <Box>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
      />
      <Box ref={containerRef} sx={{ minHeight: 65 }} />
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block", mt: 0.5 }}
      >
        为保护账号安全，请完成人机验证
      </Typography>
    </Box>
  );
}
