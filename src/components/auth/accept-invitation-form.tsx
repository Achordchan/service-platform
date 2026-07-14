"use client";

import { Alert, Button, Stack, TextField, Typography } from "@mui/material";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function AcceptInvitationForm({
  token,
  spaceName,
  email,
  defaultName = "",
  invalid = false,
  roleLabel,
  isStaff = false,
  company,
  jobTitle,
}: {
  token: string;
  spaceName?: string;
  email?: string;
  defaultName?: string;
  invalid?: boolean;
  roleLabel?: string;
  isStaff?: boolean;
  company?: string;
  jobTitle?: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (invalid || !token) return;
    setError("");
    setSubmitting(true);
    const response = await fetch("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, name, password }),
    });
    const payload = await response.json();
    setSubmitting(false);
    if (!response.ok) {
      setError(
        payload.error === "MEMBER_LIMIT_REACHED"
          ? "该客户空间的成员名额已满"
          : "邀请链接无效或已经过期",
      );
      return;
    }
    router.replace(
      `/login?invitation=${payload.data.accountExists ? "existing" : "accepted"}`,
    );
  }

  if (invalid || !token) {
    return (
      <Alert severity="error">
        邀请不可用。请让管理员重新发送邀请，或确认链接是否完整。
      </Alert>
    );
  }

  return (
    <Stack component="form" onSubmit={submit} spacing={2.25}>
      {spaceName ? (
        <Alert severity="info" icon={false}>
          <Typography sx={{ fontWeight: 650 }}>{spaceName}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            受邀邮箱：{email}
            {roleLabel ? ` · ${roleLabel}` : ""}
          </Typography>
          {company || jobTitle ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {[company, jobTitle].filter(Boolean).join(" · ")}
            </Typography>
          ) : null}
        </Alert>
      ) : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      <TextField
        label="姓名"
        value={name}
        onChange={(event) => setName(event.target.value)}
        required
        helperText="将用于服务沟通与进度通知"
      />
      <TextField
        label="登录邮箱"
        value={email ?? ""}
        fullWidth
        disabled
      />
      <TextField
        label="设置密码"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        helperText="至少 10 个字符；若账号已存在，将保留原密码"
        required
      />
      <Button type="submit" variant="contained" disabled={submitting}>
        {submitting
          ? "正在加入"
          : isStaff
            ? "加入服务支持团队"
            : `加入${spaceName ? ` ${spaceName}` : "服务空间"}`}
      </Button>
    </Stack>
  );
}
