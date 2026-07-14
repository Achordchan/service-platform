"use client";

import {
  Alert,
  Button,
  Link,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import NextLink from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState("sending");
    const result = await authClient.requestPasswordReset({
      email,
      redirectTo: "/reset-password",
    });
    setState(result.error ? "error" : "sent");
  }

  return (
    <Stack component="form" onSubmit={submit} spacing={2.25}>
      {state === "sent" ? (
        <Alert severity="success">
          若该邮箱存在，我们已发送密码重置链接。
        </Alert>
      ) : null}
      {state === "error" ? (
        <Alert severity="error">暂时无法发送，请稍后重试。</Alert>
      ) : null}
      <TextField
        label="邮箱"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        required
      />
      <Button
        type="submit"
        variant="contained"
        disabled={state === "sending"}
      >
        {state === "sending" ? "正在发送" : "发送重置链接"}
      </Button>
      <Typography variant="body2" sx={{ textAlign: "center" }}>
        <Link component={NextLink} href="/login">
          返回登录
        </Link>
      </Typography>
    </Stack>
  );
}
