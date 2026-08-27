import { redirect } from "next/navigation";
import { Alert, Stack } from "@mui/material";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { env } from "@/lib/runtime-env";
import { resolveActor } from "@/lib/actor";
import { getCurrentSession } from "@/lib/session";
import { isEmailOtpLoginAvailable } from "@/modules/platform-settings/email-otp-login-service";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // 已登录用户不应再看到登录表单，与登录成功后的跳转保持一致（/dashboard 按角色分流）。
  // 但 Better Auth 的会话 cookie 在账号被软删后 5 分钟缓存内仍有效，
  // 而 requireUserWithAccess 会因 resolveActor 为空把用户踢回 /login：
  // 只查会话不验人就形成 /login ⇄ /dashboard 重定向死循环。必须确认
  // 会话仍解析为可用账号才放行跳转；失效会话留在本页换号登录即可，
  // RSC 渲染期不能改写 cookie（Next 限制），不清除、交给换号或过期自然回收。
  const session = await getCurrentSession();
  if (session) {
    const actor = await resolveActor(session.user.id);
    if (actor) {
      redirect("/dashboard");
    }
  }
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
