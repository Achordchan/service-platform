"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { Alert, Box, Snackbar, type AlertColor } from "@mui/material";
import type {
  DeliveryFeedback,
  DeliveryFeedbackDetail,
} from "@/lib/operation-feedback";
import { deliveryFeedbackMessage } from "@/lib/operation-feedback";

type ToastOptions = {
  severity?: AlertColor;
  duration?: number;
  action?: React.ReactNode;
};

type ToastItem = {
  id: number;
  message: string;
  severity: AlertColor;
  duration: number;
  action?: React.ReactNode;
};

type ToastContextValue = {
  show: (message: string, options?: ToastOptions) => number;
  success: (message: string) => number;
  error: (message: string) => number;
  warning: (message: string) => number;
  info: (message: string) => number;
  delivery: (
    feedback?: DeliveryFeedback | null,
    detail?: DeliveryFeedbackDetail,
  ) => number | null;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const defaultDurations: Record<AlertColor, number> = {
  success: 4_500,
  error: 8_000,
  warning: 7_000,
  info: 6_000,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const nextId = useRef(0);
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const show = useCallback((message: string, options: ToastOptions = {}) => {
    const normalized = message.trim();
    if (!normalized) return -1;
    const severity = options.severity ?? "info";
    const id = ++nextId.current;
    setItems((current) => [
      ...current.slice(-3),
      {
        id,
        message: normalized,
        severity,
        duration: options.duration ?? defaultDurations[severity],
        action: options.action,
      },
    ]);
    return id;
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      show,
      success: (message) => show(message, { severity: "success" }),
      error: (message) => show(message, { severity: "error" }),
      warning: (message) => show(message, { severity: "warning" }),
      info: (message) => show(message, { severity: "info" }),
      delivery: (feedback, detail) => {
        const message = deliveryFeedbackMessage(feedback, detail);
        return message ? show(message, { severity: "info", duration: 7_000 }) : null;
      },
      dismiss,
    }),
    [dismiss, show],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Box
        aria-label="操作消息"
        sx={(theme) => ({
          position: "fixed",
          zIndex: theme.zIndex.snackbar,
          top: { xs: 12, sm: 20 },
          right: { xs: 12, sm: 20 },
          left: { xs: 12, sm: "auto" },
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 1,
          pointerEvents: "none",
        })}
      >
        {items.map((item) => (
          <Snackbar
            key={item.id}
            open
            autoHideDuration={item.duration}
            onClose={(_, reason) => {
              if (reason !== "clickaway") dismiss(item.id);
            }}
            sx={{
              position: "static",
              transform: "none",
              width: { xs: "100%", sm: 400 },
              maxWidth: "100%",
              pointerEvents: "auto",
            }}
          >
            <Alert
              severity={item.severity}
              variant="filled"
              action={item.action}
              onClose={() => dismiss(item.id)}
              sx={{
                width: "100%",
                alignItems: "flex-start",
                boxShadow: 3,
                "& .MuiAlert-message": {
                  minWidth: 0,
                  overflowWrap: "anywhere",
                },
              }}
            >
              {item.message}
            </Alert>
          </Snackbar>
        ))}
      </Box>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast 必须在 ToastProvider 内使用");
  return context;
}
