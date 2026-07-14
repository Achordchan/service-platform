import { Suspense } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { AcceptInvitationForm } from "@/components/auth/accept-invitation-form";
import { getInvitationPreview } from "@/modules/invitations/invitation-service";

export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = params.token?.trim() ?? "";
  const preview = token ? await getInvitationPreview(token) : null;

  const isStaff = preview?.kind === "staff";
  const title = preview
    ? isStaff
      ? `欢迎加入服务支持团队`
      : `欢迎加入 ${preview.spaceName}`
    : "加入服务空间";
  const description = preview
    ? isStaff
      ? `你已受邀成为服务支持中心的${preview.roleLabel}。请设置登录密码后进入后台。`
      : `你已受邀成为「${preview.spaceName}」的${preview.roleLabel}。请确认信息并设置登录密码。`
    : "邀请链接无效、已使用或已过期。请联系对接人重新发送邀请。";

  return (
    <AuthShell title={title} description={description}>
      <Suspense>
        <AcceptInvitationForm
          token={token}
          spaceName={preview?.spaceName}
          email={preview?.email}
          defaultName={preview?.nameHint || ""}
          invalid={!preview}
          roleLabel={preview?.roleLabel}
          isStaff={isStaff}
          company={preview && "company" in preview ? preview.company || undefined : undefined}
          jobTitle={preview && "jobTitle" in preview ? preview.jobTitle || undefined : undefined}
        />
      </Suspense>
    </AuthShell>
  );
}
