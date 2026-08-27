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
import QrCode2OutlinedIcon from "@mui/icons-material/QrCode2Outlined";
import { QrLoginPanel } from "@/components/auth/qr-login-panel";
import { TurnstileWidget } from "@/components/auth/turnstile-widget";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";

const passwordSchema = z.object({
  email: z.email("请输入有效邮箱"),
  password: z.string().min(1, "请输入密码"),
});

const otpFormSchema = z.object({
  email: z.email("请输入有效邮箱"),
  otp: z.string(),
});

type PasswordFormData = z.infer<typeof passwordSchema>;
type OtpFormData = z.infer<typeof otpFormSchema>;
type LoginMode = "password" | "email-otp" | "qr";

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
  turnstileSiteKey = null,
}: {
  emailOtpEnabled?: boolean;
  turnstileSiteKey?: string | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<LoginMode>("password");
  // Turnstile token 一次性：每次提交（无论成败）都重置挑战重新取 token，
  // 否则 token 已被 siteverify 消费，第二次提交必然 403
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);
  function consumeTurnstileToken() {
    setTurnstileToken(null);
    setTurnstileResetSignal((count) => count + 1);
  }
  // Turnstile token 是一次性资源，且各登录模式共用同一个挑战：
  // 任一鉴权请求在途时必须禁用其余提交入口与模式切换，否则切换模式后
  // 发出的请求会携带同一个 token，后到者在 siteverify 处因已被消费而失败。
  const [authInFlight, setAuthInFlight] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const passwordForm = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { email: "", password: "" },
  });
  const otpForm = useForm<OtpFormData>({
    resolver: zodResolver(otpFormSchema),
    defaultValues: { email: "", otp: "" },
  });
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = passwordForm;

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setResendSeconds((current) => Math.max(0, current - 1));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [resendSeconds]);

  function finishLogin() {
    queryClient.clear();
    router.replace("/dashboard");
    router.refresh();
  }

  const submitPassword = handleSubmit(async (data) => {
    passwordForm.clearErrors("root");
    setAuthInFlight(true);
    const token = turnstileToken;
    let succeeded = false;
    try {
      const result = await authClient.signIn.email({
        email: data.email,
        password: data.password,
        rememberMe: true,
        cfTurnstileToken: token ?? undefined,
      } as Parameters<typeof authClient.signIn.email>[0]);
      if (result.error) {
        // 仅失败后重置挑战以便重试取新 token；成功会立即跳转，无需再转一圈
        consumeTurnstileToken();
        passwordForm.setError("root", {
          message:
            result.error.code === "INVALID_ORIGIN"
              ? loginError(result.error.code)
              : "邮箱或密码不正确",
        });
        return;
      }
      finishLogin();
      succeeded = true;
    } catch {
      // 断网等异常路径下请求可能已被服务端消费过 token，必须重置挑战，
      // 否则重试会复用旧 token 而 403（错误信息还会误显示为密码错误）
      consumeTurnstileToken();
      passwordForm.setError("root", {
        message: "登录暂时不可用，请检查网络后重试",
      });
    } finally {
      // 成功后保持锁定直到页面卸载：dashboard 导航期间表单仍挂载，
      // 若解锁，已消费的 token 仍可被再次提交，用 403 错误覆盖成功状态
      if (!succeeded) setAuthInFlight(false);
    }
  });

  const sendOtp = otpForm.handleSubmit(async (data) => {
    const email = data.email.trim().toLowerCase();
    otpForm.clearErrors();
    setAuthInFlight(true);
    const token = turnstileToken;
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: "sign-in",
        cfTurnstileToken: token ?? undefined,
      } as Parameters<typeof authClient.emailOtp.sendVerificationOtp>[0]);
      if (result.error) {
        consumeTurnstileToken();
        otpForm.setError("root", { message: otpSendError(result.error) });
        return;
      }
      otpForm.setValue("email", email);
      setOtpSent(true);
      otpForm.setValue("otp", "");
      setResendSeconds(60);
      // 发送成功后仍停留在本页，下一步「验证并登录」需要新 token，故此处重置挑战
      consumeTurnstileToken();
    } catch {
      consumeTurnstileToken();
      otpForm.setError("root", {
        message: "验证码暂时无法发送，请稍后重试",
      });
    } finally {
      setAuthInFlight(false);
    }
  });

  const submitOtp = otpForm.handleSubmit(async ({ email, otp }) => {
    if (!/^\d{6}$/.test(otp)) {
      otpForm.setError("otp", {
        message: "请输入邮件中的 6 位验证码",
      });
      return;
    }
    otpForm.clearErrors("root");
    setAuthInFlight(true);
    const token = turnstileToken;
    let succeeded = false;
    try {
      const result = await authClient.signIn.emailOtp({
        email,
        otp,
        cfTurnstileToken: token ?? undefined,
      } as Parameters<typeof authClient.signIn.emailOtp>[0]);
      if (result.error) {
        // 仅失败后重置以便用新 token 重试；成功会跳转，无需再转
        consumeTurnstileToken();
        otpForm.setError("root", {
          message: loginError(result.error.code),
        });
        return;
      }
      finishLogin();
      succeeded = true;
    } catch {
      consumeTurnstileToken();
      otpForm.setError("root", {
        message: "验证码登录失败，请稍后重试",
      });
    } finally {
      // 与 submitPassword 一致：成功后保持锁定直到页面卸载
      if (!succeeded) setAuthInFlight(false);
    }
  });

  function changeMode(nextMode: LoginMode | null) {
    if (!nextMode || authInFlight) return;
    setMode(nextMode);
  }

  const activeRootError =
    mode === "password"
      ? passwordForm.formState.errors.root?.message
      : otpForm.formState.errors.root?.message;
  const otpBusy = otpForm.formState.isSubmitting;
  // 人机验证已启用但 token 未就绪（挑战进行中/重置后）时禁止提交：
  // 此刻发出去只会拿到 403，也让提交闭包永远拿不到过期 token
  const turnstilePending = Boolean(turnstileSiteKey) && turnstileToken === null;

  return (
    <Stack spacing={2.25}>
      <ToggleButtonGroup
        value={mode}
        exclusive
        fullWidth
        size="small"
        disabled={authInFlight}
        onChange={(_, nextMode: LoginMode | null) => changeMode(nextMode)}
        aria-label="登录方式"
      >
        <ToggleButton value="qr" aria-label="微信扫码登录">
          <QrCode2OutlinedIcon fontSize="small" sx={{ mr: 0.75 }} />
          微信扫码
        </ToggleButton>
        <ToggleButton value="password" aria-label="密码登录">
          <KeyOutlinedIcon fontSize="small" sx={{ mr: 0.75 }} />
          密码登录
        </ToggleButton>
        {emailOtpEnabled ? (
          <ToggleButton value="email-otp" aria-label="邮箱验证码登录">
            <MarkEmailReadOutlinedIcon fontSize="small" sx={{ mr: 0.75 }} />
            邮箱验证码
          </ToggleButton>
        ) : null}
      </ToggleButtonGroup>

      {activeRootError ? <Alert severity="error">{activeRootError}</Alert> : null}

      {mode !== "qr" && turnstileSiteKey ? (
        <TurnstileWidget
          siteKey={turnstileSiteKey}
          resetSignal={turnstileResetSignal}
          onToken={setTurnstileToken}
          onError={() => setTurnstileToken(null)}
        />
      ) : null}

      {mode === "qr" ? (
        <QrLoginPanel />
      ) : mode === "password" ? (
        <Stack
          key="password-login-form"
          component="form"
          onSubmit={submitPassword}
          spacing={2.25}
        >
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
            disabled={isSubmitting || authInFlight || turnstilePending}
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
        <Stack
          key="otp-login-form"
          component="form"
          onSubmit={otpSent ? submitOtp : sendOtp}
          spacing={2.25}
        >
          <Controller
            name="email"
            control={otpForm.control}
            render={({ field }) => (
              <TextField
                {...field}
                label="邮箱"
                type="email"
                autoComplete="email"
                value={field.value ?? ""}
                onChange={(event) => field.onChange(event.target.value)}
                disabled={otpSent || otpBusy}
                fullWidth
                error={Boolean(otpForm.formState.errors.email)}
                helperText={otpForm.formState.errors.email?.message}
              />
            )}
          />
          {otpSent ? (
            <>
              <Alert severity="success">
                验证码已发送，请在 5 分钟内完成登录。
              </Alert>
              <Controller
                name="otp"
                control={otpForm.control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="6 位验证码"
                    value={field.value ?? ""}
                    onChange={(event) =>
                      field.onChange(
                        event.target.value.replace(/\D/g, "").slice(0, 6),
                      )
                    }
                    autoComplete="one-time-code"
                    autoFocus
                    fullWidth
                    error={Boolean(otpForm.formState.errors.otp)}
                    helperText={otpForm.formState.errors.otp?.message}
                    slotProps={{
                      htmlInput: {
                        inputMode: "numeric",
                        pattern: "[0-9]*",
                        maxLength: 6,
                      },
                    }}
                  />
                )}
              />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <Button
                  variant="outlined"
                  onClick={() => void sendOtp()}
                  disabled={otpBusy || authInFlight || resendSeconds > 0}
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
                    otpForm.setValue("otp", "");
                    otpForm.clearErrors();
                  }}
                  disabled={otpBusy || authInFlight}
                  fullWidth
                >
                  修改邮箱
                </Button>
              </Stack>
            </>
          ) : null}
          <Button
            type="submit"
            variant="contained"
            size="large"
            disabled={otpBusy || authInFlight || turnstilePending}
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
