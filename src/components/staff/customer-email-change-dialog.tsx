"use client";

import { useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";
import type { CustomerSpaceItem } from "@/components/staff/staff-types";

type PendingChange = NonNullable<CustomerSpaceItem["pendingEmailChange"]>;

export function CustomerEmailChangeDialog({
  customer,
  onClose,
  onChanged,
}: {
  customer: CustomerSpaceItem | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [newEmail, setNewEmail] = useState("");
  const [pending, setPending] = useState<PendingChange | null>(
    customer?.pendingEmailChange ?? null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function requestChange() {
    if (!customer) return;
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const result = await staffApi<PendingChange>(
        `/api/v1/admin/users/${customer.ownerId}/email-change`,
        jsonRequest("POST", { newEmail }),
      );
      setPending(result);
      setNewEmail("");
      setSuccess(`验证邮件已发送到 ${result.newEmail}`);
      onChanged();
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "发起修改失败",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function resend() {
    if (!customer) return;
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const result = await staffApi<PendingChange>(
        `/api/v1/admin/users/${customer.ownerId}/email-change/resend`,
        jsonRequest("POST"),
      );
      setPending(result);
      setSuccess(`验证邮件已重新发送到 ${result.newEmail}`);
      onChanged();
    } catch (resendError) {
      setError(
        resendError instanceof Error ? resendError.message : "重新发送失败",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel() {
    if (!customer) return;
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      await staffApi(
        `/api/v1/admin/users/${customer.ownerId}/email-change`,
        jsonRequest("DELETE"),
      );
      setPending(null);
      setSuccess("待验证的邮箱变更已取消");
      onChanged();
    } catch (cancelError) {
      setError(
        cancelError instanceof Error ? cancelError.message : "取消失败",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={Boolean(customer)}
      onClose={submitting ? undefined : onClose}
      fullWidth
      maxWidth="sm"
    >
      {submitting ? <LinearProgress /> : null}
      <DialogTitle>修改登录邮箱</DialogTitle>
      <DialogContent>
        <Stack spacing={2.25} sx={{ pt: 0.5 }}>
          <Alert severity="warning">
            这是客户负责人的账号登录邮箱。修改成功后会影响该账号所属的所有客户空间，并退出其现有登录会话。
          </Alert>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {success ? <Alert severity="success">{success}</Alert> : null}
          <TextField
            label="当前登录邮箱"
            value={customer?.ownerEmail ?? ""}
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
              <Typography variant="body2">
                新邮箱：{pending.newEmail}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                验证有效期至：
                {new Intl.DateTimeFormat("zh-CN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(pending.expiresAt))}
              </Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <Button
                  variant="outlined"
                  onClick={() => void resend()}
                  disabled={submitting}
                >
                  重新发送验证邮件
                </Button>
                <Button
                  color="inherit"
                  onClick={() => void cancel()}
                  disabled={submitting}
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
                fullWidth
              />
              <Typography variant="body2" color="text.secondary">
                系统会向新邮箱发送一次性确认链接，有效期为 24 小时。
              </Typography>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button onClick={onClose} disabled={submitting}>
          关闭
        </Button>
        {!pending ? (
          <Button
            variant="contained"
            onClick={() => void requestChange()}
            disabled={
              submitting ||
              !newEmail ||
              newEmail === customer?.ownerEmail.toLowerCase()
            }
          >
            发送验证邮件
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  );
}
