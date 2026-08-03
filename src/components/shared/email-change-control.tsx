"use client";

import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import {
  Alert,
  Button,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useToast } from "@/components/shared/toast-provider";
import { apiRequest, jsonRequest } from "@/lib/api-client";

export type PendingEmailChange = {
  id: string;
  newEmail: string;
  expiresAt: string;
  lastSentAt: string;
  mailStatus: string | null;
  mailDispatchFailed: boolean;
};

const emailChangeFormSchema = z.object({
  newEmail: z.string().trim().email("请输入有效邮箱"),
});

type EmailChangeFormValues = z.infer<typeof emailChangeFormSchema>;

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
  return apiRequest<T>(
    url,
    jsonRequest(method, body),
    "邮箱变更操作失败",
  );
}

export function EmailChangeControl({
  currentEmail,
  initialPending,
  apiBase,
  warning,
  onChanged,
  onBusyChange,
  showCurrentEmail = true,
}: {
  currentEmail: string;
  initialPending: PendingEmailChange | null;
  apiBase: string;
  warning: string;
  onChanged?: () => void;
  onBusyChange?: (busy: boolean) => void;
  showCurrentEmail?: boolean;
}) {
  const toast = useToast();
  const [pending, setPending] = useState(initialPending);
  const form = useForm<EmailChangeFormValues>({
    resolver: zodResolver(emailChangeFormSchema),
    defaultValues: { newEmail: "" },
    mode: "onChange",
  });
  const actionMutation = useMutation({
    mutationFn: ({
      url,
      method,
      body,
    }: {
      url: string;
      method: "POST" | "DELETE";
      body?: Record<string, string>;
    }) => emailChangeApi<PendingEmailChange | null>(url, method, body),
  });
  const busy = actionMutation.isPending;

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  async function run<T>(
    url: string,
    method: "POST" | "DELETE",
    body?: Record<string, string>,
  ): Promise<{ ok: true; value: T } | { ok: false }> {
    try {
      const result = await actionMutation.mutateAsync({ url, method, body });
      onChanged?.();
      return { ok: true, value: result as T };
    } catch (actionError) {
      toast.error(
        actionError instanceof Error ? actionError.message : "邮箱变更操作失败",
      );
      return { ok: false };
    }
  }

  const requestChange = form.handleSubmit(async ({ newEmail }) => {
    if (newEmail.toLowerCase() === currentEmail.trim().toLowerCase()) {
      form.setError("newEmail", { message: "新邮箱不能与当前邮箱相同" });
      return;
    }
    const result = await run<PendingEmailChange>(apiBase, "POST", { newEmail });
    if (!result.ok) return;
    setPending(result.value);
    form.reset({ newEmail: "" });
    toast.success("验证邮件已加入发件箱，请前往新邮箱确认");
  });

  async function resend() {
    const result = await run<PendingEmailChange>(`${apiBase}/resend`, "POST");
    if (!result.ok) return;
    setPending(result.value);
    toast.success("新的验证邮件已加入发件箱");
  }

  async function cancel() {
    const result = await run<null>(apiBase, "DELETE");
    if (!result.ok) return;
    setPending(null);
    toast.success("待验证的邮箱变更已取消");
  }

  return (
    <Stack component="form" noValidate spacing={2.25} onSubmit={requestChange}>
      <Alert severity="warning">{warning}</Alert>
      {showCurrentEmail ? (
        <TextField
          label="当前登录邮箱"
          value={currentEmail}
          disabled
          fullWidth
        />
      ) : null}
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
          <Controller
            name="newEmail"
            control={form.control}
            render={({ field, fieldState }) => (
              <TextField
                {...field}
                label="新的登录邮箱"
                type="email"
                autoComplete="off"
                helperText={
                  fieldState.error?.message ??
                  "新邮箱验证成功前，当前邮箱和登录状态不会改变。"
                }
                error={Boolean(fieldState.error)}
                disabled={busy}
                fullWidth
              />
            )}
          />
          <Typography variant="body2" color="text.secondary">
            系统会向新邮箱发送一次性确认链接，有效期为 24 小时。
          </Typography>
          <Button
            type="submit"
            variant="contained"
            disabled={busy || !form.formState.isValid}
            sx={{ alignSelf: { xs: "stretch", sm: "flex-start" } }}
          >
            发送验证邮件
          </Button>
        </>
      )}
    </Stack>
  );
}
