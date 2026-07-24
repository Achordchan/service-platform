"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Alert,
  Button,
  Link,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import MarkEmailReadOutlinedIcon from "@mui/icons-material/MarkEmailReadOutlined";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";

const passwordSchema = z.object({
  email: z.email("请输入有效邮箱"),
  password: z.string().min(1, "请输入密码"),
});

type PasswordFormData = z.infer<typeof passwordSchema>;
type LoginMode = "password" | "email-otp";

function loginError(code?: string) {
  return code === "INVALID_ORIGIN"
    ? "当前访问地址不受信任，请使用启动脚本显示的本地地址重新打开"
    : "登录信息无效，请重新检查";
}

function otpSendError(error: { code?: string; message?: string }) {
  return error.code === "EMAIL_NOT_FOUND" || error.message === "邮箱不存在"
    ? "邮箱不存在，请检查后重试"
    : "验证码暂时无法发送，请确认邮件服务已启用";
}

export function LoginForm({
  emailOtpEnabled = false,
}: {
  emailOtpEnabled?: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<LoginMode>("password");
  const [error, setError] = useState("");
  const [otpEmail, setOtpEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpBusy, setOtpBusy] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setResendSeconds((current) => Math.max(0, current - 1));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [resendSeconds]);

  function finishLogin() {
    router.replace("/dashboard");
    router.refresh();
  }

  const submitPassword = handleSubmit(async (data) => {
    setError("");
    const result = await authClient.signIn.email({
      email: data.email,
      password: data.password,
      rememberMe: true,
    });
    if (result.error) {
      setError(
        result.error.code === "INVALID_ORIGIN"
          ? loginError(result.error.code)
          : "邮箱或密码不正确",
      );
      return;
    }
    finishLogin();
  });

  async function sendOtp() {
    const email = otpEmail.trim().toLowerCase();
    if (!z.email().safeParse(email).success) {
      setError("请输入有效邮箱");
      return;
    }
    setOtpBusy(true);
    setError("");
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: "sign-in",
      });
      if (result.error) {
        setError(otpSendError(result.error));
        return;
      }
      setOtpEmail(email);
      setOtpSent(true);
      setOtp("");
      setResendSeconds(60);
    } catch {
      setError("验证码暂时无法发送，请稍后重试");
    } finally {
      setOtpBusy(false);
    }
  }

  async function submitOtp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{6}$/.test(otp)) {
      setError("请输入邮件中的 6 位验证码");
      return;
    }
    setOtpBusy(true);
    setError("");
    try {
      const result = await authClient.signIn.emailOtp({
        email: otpEmail,
        otp,
      });
      if (result.error) {
        setError(loginError(result.error.code));
        return;
      }
      finishLogin();
    } catch {
      setError("验证码登录失败，请稍后重试");
    } finally {
      setOtpBusy(false);
    }
  }

  function changeMode(nextMode: LoginMode | null) {
    if (!nextMode) return;
    setMode(nextMode);
    setError("");
  }

  return (
    <Stack spacing={2.25}>
      {emailOtpEnabled ? (
        <ToggleButtonGroup
          value={mode}
          exclusive
          fullWidth
          size="small"
          onChange={(_, nextMode: LoginMode | null) => changeMode(nextMode)}
          aria-label="登录方式"
        >
          <ToggleButton value="password" aria-label="密码登录">
            <KeyOutlinedIcon fontSize="small" sx={{ mr: 0.75 }} />
            密码登录
          </ToggleButton>
          <ToggleButton value="email-otp" aria-label="邮箱验证码登录">
            <MarkEmailReadOutlinedIcon fontSize="small" sx={{ mr: 0.75 }} />
            邮箱验证码
          </ToggleButton>
        </ToggleButtonGroup>
      ) : null}

      {error ? <Alert severity="error">{error}</Alert> : null}

      {mode === "password" ? (
        <Stack component="form" onSubmit={submitPassword} spacing={2.25}>
          <Controller
            name="email"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                value={field.value ?? ""}
                label="邮箱"
                autoComplete="email"
                error={Boolean(errors.email)}
                helperText={errors.email?.message}
              />
            )}
          />
          <Controller
            name="password"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                value={field.value ?? ""}
                label="密码"
                type="password"
                autoComplete="current-password"
                error={Boolean(errors.password)}
                helperText={errors.password?.message}
              />
            )}
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
      ) : (
        <Stack component="form" onSubmit={submitOtp} spacing={2.25}>
          <TextField
            label="邮箱"
            type="email"
            autoComplete="email"
            value={otpEmail ?? ""}
            onChange={(event) => setOtpEmail(event.target.value)}
            disabled={otpSent || otpBusy}
            fullWidth
          />
          {otpSent ? (
            <>
              <Alert severity="success">
                验证码已发送，请在 5 分钟内完成登录。
              </Alert>
              <TextField
                label="6 位验证码"
                value={otp ?? ""}
                onChange={(event) =>
                  setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                autoComplete="one-time-code"
                autoFocus
                fullWidth
                slotProps={{
                  htmlInput: {
                    inputMode: "numeric",
                    pattern: "[0-9]*",
                    maxLength: 6,
                  },
                }}
              />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <Button
                  variant="outlined"
                  onClick={() => void sendOtp()}
                  disabled={otpBusy || resendSeconds > 0}
                  fullWidth
                >
                  {resendSeconds > 0
                    ? `${resendSeconds} 秒后重发`
                    : "重新发送"}
                </Button>
                <Button
                  color="inherit"
                  onClick={() => {
                    setOtpSent(false);
                    setOtp("");
                    setError("");
                  }}
                  disabled={otpBusy}
                  fullWidth
                >
                  修改邮箱
                </Button>
              </Stack>
            </>
          ) : null}
          <Button
            type={otpSent ? "submit" : "button"}
            variant="contained"
            size="large"
            disabled={otpBusy}
            onClick={otpSent ? undefined : () => void sendOtp()}
            sx={{ mt: 0.5, py: 1.15, fontWeight: 650 }}
          >
            {otpBusy
              ? otpSent
                ? "正在验证"
                : "正在发送"
              : otpSent
                ? "验证并登录"
                : "发送验证码"}
          </Button>
        </Stack>
      )}
    </Stack>
  );
}
