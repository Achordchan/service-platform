"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Alert,
  Button,
  Link,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";

const schema = z.object({
  email: z.email("请输入有效邮箱"),
  password: z.string().min(1, "请输入密码"),
});

type FormData = z.infer<typeof schema>;

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = handleSubmit(async (data) => {
    setError("");
    const result = await authClient.signIn.email({
      email: data.email,
      password: data.password,
      rememberMe: true,
    });
    if (result.error) {
      setError(
        result.error.code === "INVALID_ORIGIN"
          ? "当前访问地址不受信任，请使用启动脚本显示的本地地址重新打开"
          : "邮箱或密码不正确",
      );
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  });

  return (
    <Stack
      component="form"
      onSubmit={onSubmit}
      spacing={2.25}
    >
      {error ? <Alert severity="error">{error}</Alert> : null}
      <TextField
        label="邮箱"
        autoComplete="email"
        error={Boolean(errors.email)}
        helperText={errors.email?.message}
        {...register("email")}
      />
      <TextField
        label="密码"
        type="password"
        autoComplete="current-password"
        error={Boolean(errors.password)}
        helperText={errors.password?.message}
        {...register("password")}
      />
      <Button
        type="submit"
        variant="contained"
        size="large"
        disabled={isSubmitting}
        sx={{ mt: 0.5, py: 1.15, fontWeight: 650 }}
      >
        {isSubmitting ? "正在登录" : "登录"}
      </Button>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ textAlign: "center" }}
      >
        忘记密码？
        <Link component={NextLink} href="/forgot-password" sx={{ ml: 0.5 }}>
          重置密码
        </Link>
      </Typography>
    </Stack>
  );
}
