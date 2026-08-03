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
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";

const forgotPasswordSchema = z.object({
  email: z.email("请输入有效邮箱"),
});

type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

export function ForgotPasswordForm() {
  const {
    control,
    handleSubmit,
    setError,
    clearErrors,
    formState: { errors, isSubmitSuccessful, isSubmitting },
  } = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const submit = handleSubmit(async ({ email }) => {
    clearErrors("root");
    const result = await authClient.requestPasswordReset({
      email,
      redirectTo: "/reset-password",
    });
    if (result.error) {
      setError("root", { message: "暂时无法发送，请稍后重试。" });
    }
  });

  return (
    <Stack component="form" onSubmit={submit} spacing={2.25}>
      {isSubmitSuccessful && !errors.root ? (
        <Alert severity="success">
          若该邮箱存在，我们已发送密码重置链接。
        </Alert>
      ) : null}
      {errors.root?.message ? <Alert severity="error">{errors.root.message}</Alert> : null}
      <Controller
        name="email"
        control={control}
        render={({ field }) => (
          <TextField
            {...field}
            label="邮箱"
            type="email"
            required
            error={Boolean(errors.email)}
            helperText={errors.email?.message}
          />
        )}
      />
      <Button
        type="submit"
        variant="contained"
        disabled={isSubmitting}
      >
        {isSubmitting ? "正在发送" : "发送重置链接"}
      </Button>
      <Typography variant="body2" sx={{ textAlign: "center" }}>
        <Link component={NextLink} href="/login">
          返回登录
        </Link>
      </Typography>
    </Stack>
  );
}
