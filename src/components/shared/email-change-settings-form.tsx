"use client";

import { Paper, Stack, Typography } from "@mui/material";
import { useRouter } from "next/navigation";
import {
  EmailChangeControl,
  type PendingEmailChange,
} from "@/components/shared/email-change-control";

export function EmailChangeSettingsForm({
  currentEmail,
  initialPending,
}: {
  currentEmail: string;
  initialPending: PendingEmailChange | null;
}) {
  const router = useRouter();
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2.5, md: 3 } }}>
      <Stack spacing={2.25}>
        <div>
          <Typography sx={{ fontWeight: 700 }}>登录邮箱</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            登录邮箱修改完成后，当前账号的其他登录会话会自动退出。
          </Typography>
        </div>
        <EmailChangeControl
          key={`${initialPending?.id ?? "none"}:${initialPending?.lastSentAt ?? "none"}:${initialPending?.mailStatus ?? "none"}:${initialPending?.mailDispatchFailed ?? false}`}
          currentEmail={currentEmail}
          initialPending={initialPending}
          apiBase="/api/v1/me/email-change"
          warning="请确认新邮箱由你本人控制。系统只会在新邮箱完成验证后更新登录邮箱。"
          onChanged={() => router.refresh()}
        />
      </Stack>
    </Paper>
  );
}
