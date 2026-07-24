"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Avatar,
  Box,
  Button,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import PhotoCameraOutlinedIcon from "@mui/icons-material/PhotoCameraOutlined";
import { useToast } from "@/components/shared/toast-provider";
import { resolveAvatarSrc } from "@/lib/default-avatar";

export function ProfileSettingsForm({
  user,
}: {
  user: {
    id: string;
    name: string;
    email: string;
    image?: string | null;
  };
}) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(user.name);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
    <Paper component="form" variant="outlined" onSubmit={submit} sx={{ p: { xs: 2.5, md: 3 } }}>
      {submitting ? <LinearProgress sx={{ mb: 2 }} /> : null}
      <Stack spacing={2.5}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2.5} sx={{ alignItems: "center" }}>
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
        <TextField label="邮箱" value={user.email} fullWidth disabled />
        <Button
          type="submit"
          variant="contained"
          disabled={submitting || name.trim().length < 2}
          sx={{ alignSelf: { xs: "stretch", sm: "flex-start" } }}
        >
          保存资料
        </Button>
      </Stack>
    </Paper>
  );
}
