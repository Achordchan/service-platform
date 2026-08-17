"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
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
import {
  FilePickerButton,
  IMAGE_FILE_ACCEPT,
  firstFileRejectionMessage,
} from "@/components/shared/file-picker";
import { useToast } from "@/components/shared/toast-provider";
import { resolveAvatarSrc } from "@/lib/default-avatar";
import { apiRequest } from "@/lib/api-client";

const profileFormSchema = z.object({
  name: z.string().trim().min(2, "姓名至少需要 2 个字符").max(60),
  avatar: z.custom<File>().nullable(),
});

type ProfileFormValues = z.infer<typeof profileFormSchema>;

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
  const [preview, setPreview] = useState<string | null>(null);
  const [editingEmail, setEditingEmail] = useState(
    Boolean(initialPendingEmailChange),
  );
  const {
    control,
    handleSubmit,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: { name: user.name, avatar: null },
  });
  const name = useWatch({ control, name: "name" });
  const showEmailChange = editingEmail || Boolean(initialPendingEmailChange);

  const avatarSrc = useMemo(
    () => preview || resolveAvatarSrc(user.image, name || user.name, user.id),
    [preview, user.image, name, user.name, user.id],
  );

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const submit = handleSubmit(async ({ name: submittedName, avatar }) => {
    try {
      const formData = new FormData();
      const normalizedName = submittedName.trim();
      formData.append("name", normalizedName);
      if (avatar) formData.append("avatar", avatar);
      await apiRequest(
        "/api/v1/profile",
        { method: "PATCH", body: formData },
        "保存失败",
      );
      reset({ name: normalizedName, avatar: null });
      setPreview(null);
      toast.success("个人资料已更新");
      router.refresh();
    } catch (submitError) {
      toast.error(
        submitError instanceof Error ? submitError.message : "保存失败",
      );
    }
  });

  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
      {isSubmitting ? <LinearProgress sx={{ mb: 2 }} /> : null}
      <Stack component="form" noValidate spacing={2} onSubmit={submit}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2.5}
          sx={{ alignItems: "center" }}
        >
          <Avatar src={avatarSrc} alt={name} sx={{ width: 64, height: 64, fontSize: 24 }}>
            {(name || user.name).slice(0, 1)}
          </Avatar>
          <Box>
            <Typography sx={{ fontWeight: 650 }}>头像</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              JPG / PNG / GIF / WebP，最大 2MB
            </Typography>
            <FilePickerButton
              startIcon={<PhotoCameraOutlinedIcon />}
              sx={{ mt: 1.25 }}
              disabled={isSubmitting}
              accept={IMAGE_FILE_ACCEPT}
              maxSize={2 * 1024 * 1024}
              onFiles={([next]) => {
                if (!next) return;
                setValue("avatar", next, { shouldDirty: true });
                setPreview(URL.createObjectURL(next));
              }}
              onRejected={(rejections) =>
                toast.warning(firstFileRejectionMessage(rejections))
              }
            >
              选择图片
            </FilePickerButton>
          </Box>
        </Stack>
        <Controller
          name="name"
          control={control}
          render={({ field }) => (
            <TextField
              {...field}
              label="姓名"
              fullWidth
              required
              disabled={isSubmitting}
              error={Boolean(errors.name)}
              helperText={errors.name?.message}
              slotProps={{ htmlInput: { minLength: 2, maxLength: 60 } }}
            />
          )}
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
          disabled={isSubmitting}
          sx={{ alignSelf: { xs: "stretch", sm: "flex-start" } }}
        >
          保存资料
        </Button>
      </Stack>
      {showEmailChange ? (
        <>
          <Divider sx={{ my: 3 }} />
          <Stack spacing={2}>
            <div>
              <Typography sx={{ fontWeight: 650 }}>修改登录邮箱</Typography>
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
