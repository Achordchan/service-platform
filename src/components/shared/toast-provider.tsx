"use client";

import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
} from "react";
import { Alert, type AlertColor } from "@mui/material";
import { useColorScheme } from "@mui/material/styles";
import { Toaster, toast as sonnerToast } from "sonner";
import type {
  DeliveryFeedback,
  DeliveryFeedbackDetail,
} from "@/lib/operation-feedback";
import { deliveryFeedbackMessage } from "@/lib/operation-feedback";

type ToastId = string | number;

type ToastOptions = {
  severity?: AlertColor;
  duration?: number;
  action?: React.ReactNode;
};

type ToastContextValue = {
  show: (message: string, options?: ToastOptions) => ToastId;
  success: (message: string) => ToastId;
  error: (message: string) => ToastId;
  warning: (message: string) => ToastId;
  info: (message: string) => ToastId;
  delivery: (
    feedback?: DeliveryFeedback | null,
    detail?: DeliveryFeedbackDetail,
  ) => ToastId | null;
  dismiss: (id: ToastId) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const defaultDurations: Record<AlertColor, number> = {
  success: 4_500,
  error: 8_000,
  warning: 7_000,
  info: 6_000,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const toasterId = useId();
  const { mode, systemMode } = useColorScheme();
  const toasterTheme = mode === "system" ? systemMode : mode;

  const dismiss = useCallback((id: ToastId) => {
    sonnerToast.dismiss(id);
  }, []);

  const show = useCallback((message: string, options: ToastOptions = {}) => {
    const normalized = message.trim();
    if (!normalized) return -1;
    const severity = options.severity ?? "info";
    return sonnerToast.custom(
      (id) => (
        <Alert
          severity={severity}
          variant="filled"
          action={options.action}
          onClose={() => sonnerToast.dismiss(id)}
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
          {normalized}
        </Alert>
      ),
      {
        duration: options.duration ?? defaultDurations[severity],
        toasterId,
      },
    );
  }, [toasterId]);

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
      <Toaster
        id={toasterId}
        theme={toasterTheme ?? "light"}
        position="top-right"
        expand
        visibleToasts={4}
        gap={8}
        offset={{ top: 20, right: 20 }}
        mobileOffset={{ top: 12, right: 12, left: 12 }}
        containerAriaLabel="操作消息"
        style={{ "--width": "400px" } as React.CSSProperties}
      />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast 必须在 ToastProvider 内使用");
  return context;
}
