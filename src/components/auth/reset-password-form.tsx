"use client";

import { Alert, Button, Stack, TextField } from "@mui/material";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";

const resetPasswordSchema = z
  .object({
    password: z.string().min(10, "密码至少需要 10 个字符").max(128),
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "两次输入的密码不一致",
  });

type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const submit = handleSubmit(async ({ password }) => {
    const result = await authClient.resetPassword({ newPassword: password, token });
    if (result.error) {
      setError("root", { message: "链接无效或已经过期" });
      return;
    }
    router.replace("/login?reset=success");
  });

  return (
    <Stack component="form" onSubmit={submit} spacing={2.25}>
      {!token ? <Alert severity="error">缺少密码重置令牌</Alert> : null}
      {errors.root?.message ? <Alert severity="error">{errors.root.message}</Alert> : null}
      <Controller
        name="password"
        control={control}
        render={({ field }) => (
          <TextField
            {...field}
            label="新密码"
            type="password"
            autoComplete="new-password"
            error={Boolean(errors.password)}
            helperText={errors.password?.message}
          />
        )}
      />
      <Controller
        name="confirmPassword"
        control={control}
        render={({ field }) => (
          <TextField
            {...field}
            label="确认新密码"
            type="password"
            autoComplete="new-password"
            error={Boolean(errors.confirmPassword)}
            helperText={errors.confirmPassword?.message}
          />
        )}
      />
      <Button
        type="submit"
        variant="contained"
        disabled={!token || isSubmitting}
      >
        {isSubmitting ? "正在保存" : "设置新密码"}
      </Button>
    </Stack>
  );
}
