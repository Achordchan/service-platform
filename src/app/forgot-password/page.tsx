import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="重置密码"
      description="输入受邀账号邮箱。若账号有效，将收到重置链接。"
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
