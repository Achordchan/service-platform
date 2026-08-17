import { Alert, Stack } from "@mui/material";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { env } from "@/lib/runtime-env";
import { isEmailOtpLoginAvailable } from "@/modules/platform-settings/email-otp-login-service";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const emailOtpEnabled = await isEmailOtpLoginAvailable();
  return (
    <AuthShell brandSide title="登录" description="使用受邀邮箱登录">
      <Stack spacing={2}>
        {params.reset === "success" ? (
          <Alert severity="success">密码已更新，请重新登录。</Alert>
        ) : null}
        {params.invitation ? (
          <Alert severity="success">
            邀请已接受，请使用该邮箱登录。
          </Alert>
        ) : null}
        <LoginForm emailOtpEnabled={emailOtpEnabled} turnstileSiteKey={env.CF_TURNSTILE_SITE_KEY ?? null} />
      </Stack>
    </AuthShell>
  );
}
