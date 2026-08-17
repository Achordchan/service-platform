import { AccountSettingsView } from "@/components/shared/account-settings-view";
import { PageHeading } from "@/components/customer/page-heading";

export const metadata = {
  title: "个人设置",
};

export default async function CustomerAccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const section = Array.isArray(params.section) ? params.section[0] : params.section;
  return (
    <AccountSettingsView
      heading={<PageHeading title="个人设置" />}
      initialSection={section}
    />
  );
}
