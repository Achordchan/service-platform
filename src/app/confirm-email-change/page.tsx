import { AuthShell } from "@/components/auth/auth-shell";
import { ConfirmEmailChangeForm } from "@/components/auth/confirm-email-change-form";
import { getEmailChangePreview } from "@/modules/users/customer-email-change-service";

export const metadata = {
  title: "确认登录邮箱",
};

export default async function ConfirmEmailChangePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = params.token?.trim() ?? "";
  const preview = token ? await getEmailChangePreview(token) : null;

  return (
    <AuthShell
      title="确认登录邮箱"
      description={
        preview
          ? "请核对新邮箱，确认后需要重新登录"
          : "该邮箱确认请求当前不可用"
      }
    >
      <ConfirmEmailChangeForm
        token={token}
        invalid={!preview}
        oldEmail={preview?.oldEmail}
        newEmail={preview?.newEmail}
      />
    </AuthShell>
  );
}
