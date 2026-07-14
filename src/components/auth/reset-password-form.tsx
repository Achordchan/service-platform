"use client";

import { Alert, Button, Stack, TextField } from "@mui/material";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 10) {
      setError("密码至少需要 10 个字符");
      return;
    }
    if (password !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    setSubmitting(true);
    const result = await authClient.resetPassword({ newPassword: password, token });
    setSubmitting(false);
    if (result.error) {
      setError("链接无效或已经过期");
      return;
    }
    router.replace("/login?reset=success");
  }

  return (
    <Stack component="form" onSubmit={submit} spacing={2.25}>
      {!token ? <Alert severity="error">缺少密码重置令牌</Alert> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      <TextField
        label="新密码"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="new-password"
      />
      <TextField
        label="确认新密码"
        type="password"
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        autoComplete="new-password"
      />
      <Button
        type="submit"
        variant="contained"
        disabled={!token || submitting}
      >
        {submitting ? "正在保存" : "设置新密码"}
      </Button>
    </Stack>
  );
}
