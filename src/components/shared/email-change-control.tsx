"use client";

import { useState } from "react";
import {
  Alert,
  Button,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useToast } from "@/components/shared/toast-provider";

export type PendingEmailChange = {
  id: string;
  newEmail: string;
  expiresAt: string;
  lastSentAt: string;
  mailStatus: string | null;
  mailDispatchFailed: boolean;
};

function mailStatusMessage(status: string | null, dispatchFailed: boolean) {
  if (status === "QUEUED") {
    if (dispatchFailed) {
      return {
        severity: "warning" as const,
        text: "验证邮件暂未进入发送队列，系统会自动重试。",
      };
    }
    return {
      severity: "success" as const,
      text: "验证邮件已进入发件箱，系统正在发送。",
    };
  }
  if (status === "PROCESSING") {
    return { severity: "info" as const, text: "验证邮件正在发送。" };
  }
  if (
    status === "FAILED" ||
    status === "BOUNCED" ||
    status === "COMPLAINED" ||
    status === "SUPPRESSED"
  ) {
    return {
      severity: "error" as const,
      text: "验证邮件发送失败，可重新发送生成新的验证链接。",
    };
  }
  if (status === "CANCELLED") {
    return {
      severity: "warning" as const,
      text: "验证邮件已取消，可重新发送生成新的验证链接。",
    };
  }
  if (status) {
    return {
      severity: "success" as const,
      text: "验证邮件已发送，正在等待新邮箱确认。",
    };
  }
  return {
    severity: "warning" as const,
    text: "尚未找到验证邮件记录，请重新发送。",
  };
}

async function emailChangeApi<T>(
  url: string,
  method: "POST" | "DELETE",
  body?: Record<string, string>,
) {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 204) return null as T;
  const payload = (await response.json()) as {
    data?: T;
    error?: { message?: string };
  };
  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error?.message || "邮箱变更操作失败");
  }
  return payload.data;
}

export function EmailChangeControl({
  currentEmail,
  initialPending,
  apiBase,
  warning,
  onChanged,
  onBusyChange,
}: {
  currentEmail: string;
  initialPending: PendingEmailChange | null;
  apiBase: string;
  warning: string;
  onChanged?: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const toast = useToast();
  const [newEmail, setNewEmail] = useState("");
  const [pending, setPending] = useState(initialPending);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    onBusyChange?.(true);
    try {
      await action();
      onChanged?.();
    } catch (actionError) {
      toast.error(
        actionError instanceof Error ? actionError.message : "邮箱变更操作失败",
      );
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  function requestChange() {
    return run(async () => {
      const result = await emailChangeApi<PendingEmailChange>(
        apiBase,
        "POST",
        { newEmail },
      );
      setPending(result);
      setNewEmail("");
      toast.success("验证邮件已加入发件箱，请前往新邮箱确认");
    });
  }

  function resend() {
    return run(async () => {
      const result = await emailChangeApi<PendingEmailChange>(
        `${apiBase}/resend`,
        "POST",
      );
      setPending(result);
      toast.success("新的验证邮件已加入发件箱");
    });
  }

  function cancel() {
    return run(async () => {
      await emailChangeApi<null>(apiBase, "DELETE");
      setPending(null);
      toast.success("待验证的邮箱变更已取消");
    });
  }

  return (
    <Stack spacing={2.25}>
      <Alert severity="warning">{warning}</Alert>
      <TextField
        label="当前登录邮箱"
        value={currentEmail}
        disabled
        fullWidth
      />
      {pending ? (
        <Stack
          spacing={1}
          sx={{
            p: 1.75,
            border: "1px solid",
            borderColor: "warning.light",
            borderRadius: 2,
            bgcolor: "rgba(217,139,22,0.04)",
          }}
        >
          <Typography sx={{ fontWeight: 700 }}>等待新邮箱确认</Typography>
          <Typography variant="body2">新邮箱：{pending.newEmail}</Typography>
          <Typography variant="body2" color="text.secondary">
            验证有效期至：
            {new Intl.DateTimeFormat("zh-CN", {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(pending.expiresAt))}
          </Typography>
          <Alert
            severity={
              mailStatusMessage(
                pending.mailStatus,
                pending.mailDispatchFailed,
              ).severity
            }
          >
            {
              mailStatusMessage(
                pending.mailStatus,
                pending.mailDispatchFailed,
              ).text
            }
          </Alert>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <Button
              variant="outlined"
              onClick={() => void resend()}
              disabled={busy}
            >
              重新发送验证邮件
            </Button>
            <Button
              color="inherit"
              onClick={() => void cancel()}
              disabled={busy}
            >
              取消修改
            </Button>
          </Stack>
        </Stack>
      ) : (
        <>
          <TextField
            label="新的登录邮箱"
            type="email"
            value={newEmail}
            onChange={(event) =>
              setNewEmail(event.target.value.trim().toLowerCase())
            }
            autoComplete="off"
            helperText="新邮箱验证成功前，当前邮箱和登录状态不会改变。"
            disabled={busy}
            fullWidth
          />
          <Typography variant="body2" color="text.secondary">
            系统会向新邮箱发送一次性确认链接，有效期为 24 小时。
          </Typography>
          <Button
            variant="contained"
            onClick={() => void requestChange()}
            disabled={
              busy ||
              !newEmail ||
              newEmail === currentEmail.trim().toLowerCase()
            }
            sx={{ alignSelf: { xs: "stretch", sm: "flex-start" } }}
          >
            发送验证邮件
          </Button>
        </>
      )}
    </Stack>
  );
}
