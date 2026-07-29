"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Avatar,
  Box,
  Button,
  Chip,
  Divider,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AlternateEmailOutlinedIcon from "@mui/icons-material/AlternateEmailOutlined";
import PhotoCameraOutlinedIcon from "@mui/icons-material/PhotoCameraOutlined";
import {
  EmailChangeControl,
  type PendingEmailChange,
} from "@/components/shared/email-change-control";
import { useToast } from "@/components/shared/toast-provider";
import { resolveAvatarSrc } from "@/lib/default-avatar";

export function ProfileSettingsForm({
  user,
  initialPendingEmailChange,
}: {
  user: {
    id: string;
    name: string;
    email: string;
    image?: string | null;
  };
  initialPendingEmailChange: PendingEmailChange | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(user.name);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editingEmail, setEditingEmail] = useState(
    Boolean(initialPendingEmailChange),
  );
  const showEmailChange = editingEmail || Boolean(initialPendingEmailChange);

  const avatarSrc = useMemo(
    () => preview || resolveAvatarSrc(user.image, name || user.name, user.id),
    [preview, user.image, name, user.name, user.id],
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("name", name.trim());
      if (file) formData.append("avatar", file);
      const response = await fetch("/api/v1/profile", {
        method: "PATCH",
        body: formData,
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message || "保存失败");
      }
      setFile(null);
      setPreview(null);
      toast.success("个人资料已更新");
      router.refresh();
    } catch (submitError) {
      toast.error(
        submitError instanceof Error ? submitError.message : "保存失败",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2.5, md: 3 } }}>
      {submitting ? <LinearProgress sx={{ mb: 2 }} /> : null}
      <Stack component="form" spacing={2.5} onSubmit={submit}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2.5}
          sx={{ alignItems: "center" }}
        >
          <Avatar src={avatarSrc} alt={name} sx={{ width: 84, height: 84, fontSize: 28 }}>
            {(name || user.name).slice(0, 1)}
          </Avatar>
          <Box>
            <Typography sx={{ fontWeight: 650 }}>头像</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              支持 JPG / PNG / GIF / WebP，最大 2MB。未上传时使用默认头像。
            </Typography>
            <Button
              component="label"
              startIcon={<PhotoCameraOutlinedIcon />}
              sx={{ mt: 1.25 }}
              disabled={submitting}
            >
              选择图片
              <input
                hidden
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                onChange={(event) => {
                  const next = event.target.files?.[0] ?? null;
                  setFile(next);
                  if (preview) URL.revokeObjectURL(preview);
                  setPreview(next ? URL.createObjectURL(next) : null);
                }}
              />
            </Button>
          </Box>
        </Stack>
        <TextField
          label="姓名"
          value={name}
          onChange={(event) => setName(event.target.value)}
          fullWidth
          required
          disabled={submitting}
          slotProps={{ htmlInput: { minLength: 2, maxLength: 60 } }}
        />
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.25}
          sx={{ alignItems: { sm: "center" } }}
        >
          <TextField label="登录邮箱" value={user.email} fullWidth disabled />
          {initialPendingEmailChange ? (
            <Chip
              label="等待确认"
              color="warning"
              variant="outlined"
              sx={{ alignSelf: { xs: "flex-start", sm: "center" } }}
            />
          ) : (
            <Button
              type="button"
              variant="outlined"
              startIcon={<AlternateEmailOutlinedIcon />}
              onClick={() => setEditingEmail((value) => !value)}
              sx={{
                flexShrink: 0,
                alignSelf: { xs: "stretch", sm: "center" },
                whiteSpace: "nowrap",
              }}
            >
              {editingEmail ? "收起" : "修改邮箱"}
            </Button>
          )}
        </Stack>
        <Button
          type="submit"
          variant="contained"
          disabled={submitting || name.trim().length < 2}
          sx={{ alignSelf: { xs: "stretch", sm: "flex-start" } }}
        >
          保存资料
        </Button>
      </Stack>
      {showEmailChange ? (
        <>
          <Divider sx={{ my: 3 }} />
          <Stack spacing={2.25}>
            <div>
              <Typography sx={{ fontWeight: 700 }}>修改登录邮箱</Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.5 }}
              >
                修改完成后，当前账号的其他登录会话会自动退出。
              </Typography>
            </div>
            <EmailChangeControl
              currentEmail={user.email}
              initialPending={initialPendingEmailChange}
              apiBase="/api/v1/me/email-change"
              warning="请确认新邮箱由你本人控制。系统只会在新邮箱完成验证后更新登录邮箱。"
              showCurrentEmail={false}
              onChanged={() => router.refresh()}
            />
          </Stack>
        </>
      ) : null}
    </Paper>
  );
}
