"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, Button, LinearProgress, Stack, Typography } from "@mui/material";
import { apiRequest, jsonRequest } from "@/lib/api-client";

export function ConfirmEmailChangeForm({
  token,
  invalid,
  oldEmail,
  newEmail,
}: {
  token: string;
  invalid: boolean;
  oldEmail?: string;
  newEmail?: string;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [completedEmail, setCompletedEmail] = useState("");

  async function confirm() {
    setSubmitting(true);
    setError("");
    try {
      const result = await apiRequest<{ newEmail: string }>(
        "/api/v1/email-changes/confirm",
        jsonRequest("POST", { token }),
        "邮箱修改失败",
      );
      setCompletedEmail(result.newEmail);
    } catch (confirmError) {
      setError(
        confirmError instanceof Error ? confirmError.message : "邮箱修改失败",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (completedEmail) {
    return (
      <Stack spacing={2}>
        <Alert severity="success">登录邮箱已修改为 {completedEmail}。</Alert>
        <Typography color="text.secondary">
          原有登录会话已退出，请使用新邮箱重新登录。
        </Typography>
        <Button component={Link} href="/login" variant="contained">
          前往登录
        </Button>
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      {submitting ? <LinearProgress /> : null}
      {invalid ? (
        <Alert severity="error">确认链接无效、已使用或已过期。</Alert>
      ) : (
        <>
          <Alert severity="warning">
            确认后，登录邮箱将由 {oldEmail} 修改为 {newEmail}
            ，所有现有登录会话会退出。
          </Alert>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <Button
            variant="contained"
            onClick={() => void confirm()}
            disabled={submitting}
          >
            {submitting ? "正在确认" : "确认修改登录邮箱"}
          </Button>
        </>
      )}
      <Button component={Link} href="/login" color="inherit">
        返回登录
      </Button>
    </Stack>
  );
}
