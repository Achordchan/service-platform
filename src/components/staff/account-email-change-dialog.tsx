"use client";

import { useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
} from "@mui/material";
import {
  EmailChangeControl,
  type PendingEmailChange,
} from "@/components/shared/email-change-control";

export type EmailChangeTarget = {
  id: string;
  name: string;
  email: string;
  pendingEmailChange: PendingEmailChange | null;
};

export function AccountEmailChangeDialog({
  target,
  onClose,
  onChanged,
}: {
  target: EmailChangeTarget | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={Boolean(target)}
      onClose={busy ? undefined : onClose}
      fullWidth
      maxWidth="sm"
    >
      {busy ? <LinearProgress /> : null}
      <DialogTitle>修改登录邮箱</DialogTitle>
      <DialogContent dividers>
        {target ? (
          <EmailChangeControl
            key={`${target.id}:${target.pendingEmailChange?.lastSentAt ?? "none"}:${target.pendingEmailChange?.mailStatus ?? "none"}:${target.pendingEmailChange?.mailDispatchFailed ?? false}`}
            currentEmail={target.email}
            initialPending={target.pendingEmailChange}
            apiBase={`/api/v1/admin/users/${target.id}/email-change`}
            warning={`正在修改“${target.name}”的登录邮箱。确认完成后，该账号现有登录会话会自动退出。`}
            onChanged={onChanged}
            onBusyChange={setBusy}
          />
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={busy}>
          关闭
        </Button>
      </DialogActions>
    </Dialog>
  );
}
