"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  Alert,
  Button,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { useToast } from "@/components/shared/toast-provider";
import { authClient } from "@/lib/auth-client";

const MIN_PASSWORD_LENGTH = 10;

const schema = z
  .object({
    currentPassword: z.string().min(1, "请输入当前密码"),
    newPassword: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `新密码至少 ${MIN_PASSWORD_LENGTH} 个字符`),
    confirmPassword: z.string().min(1, "请确认新密码"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "两次输入的新密码不一致",
    path: ["confirmPassword"],
  });

type FormValues = z.infer<typeof schema>;

export function PasswordChangeForm({
  hasPassword,
}: {
  hasPassword: boolean;
}) {
  const toast = useToast();
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  if (!hasPassword) {
    return (
      <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }}>
        <Typography sx={{ fontWeight: 650 }}>修改密码</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
          当前账号通过邮箱验证码登录，未设置密码。如需使用密码登录，请在登录页使用「忘记密码」流程设置初始密码。
        </Typography>
      </Paper>
    );
  }

  const submit = handleSubmit(async (values) => {
    setServerError(null);
    const result = await authClient.changePassword({
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
      revokeOtherSessions: true,
    });
    if (result.error) {
      const message =
        result.error.code === "INVALID_PASSWORD"
          ? "当前密码不正确"
          : result.error.message || "密码修改失败，请稍后重试";
      setServerError(message);
      return;
    }
    toast.success("密码已修改，其他登录会话已退出");
    reset();
  });

  return (
    <Paper
      component="form"
      variant="outlined"
      onSubmit={submit}
      sx={{ p: { xs: 1.5, sm: 2 } }}
    >
      <Stack spacing={2}>
        <div>
          <Typography sx={{ fontWeight: 650 }}>修改密码</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            修改后，当前账号的其他登录会话会自动退出。
          </Typography>
        </div>

        {serverError ? (
          <Alert severity="error" onClose={() => setServerError(null)}>
            {serverError}
          </Alert>
        ) : null}

        <TextField
          {...register("currentPassword")}
          label="当前密码"
          type={showCurrent ? "text" : "password"}
          autoComplete="current-password"
          error={Boolean(errors.currentPassword)}
          helperText={errors.currentPassword?.message}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    aria-label={showCurrent ? "隐藏密码" : "显示密码"}
                    onClick={() => setShowCurrent((v) => !v)}
                    edge="end"
                    size="small"
                  >
                    {showCurrent ? (
                      <VisibilityOffOutlinedIcon fontSize="small" />
                    ) : (
                      <VisibilityOutlinedIcon fontSize="small" />
                    )}
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
        />
        <TextField
          {...register("newPassword")}
          label="新密码"
          type={showNew ? "text" : "password"}
          autoComplete="new-password"
          error={Boolean(errors.newPassword)}
          helperText={errors.newPassword?.message}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    aria-label={showNew ? "隐藏密码" : "显示密码"}
                    onClick={() => setShowNew((v) => !v)}
                    edge="end"
                    size="small"
                  >
                    {showNew ? (
                      <VisibilityOffOutlinedIcon fontSize="small" />
                    ) : (
                      <VisibilityOutlinedIcon fontSize="small" />
                    )}
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
        />
        <TextField
          {...register("confirmPassword")}
          label="确认新密码"
          type={showNew ? "text" : "password"}
          autoComplete="new-password"
          error={Boolean(errors.confirmPassword)}
          helperText={errors.confirmPassword?.message}
        />
        <Button
          type="submit"
          variant="contained"
          disabled={isSubmitting}
          sx={{ alignSelf: { xs: "stretch", sm: "flex-start" } }}
        >
          修改密码
        </Button>
      </Stack>
    </Paper>
  );
}
