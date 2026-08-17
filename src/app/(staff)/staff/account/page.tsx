import { AccountSettingsView } from "@/components/shared/account-settings-view";
import { StaffPageHeading } from "@/components/staff/staff-page-heading";

export const metadata = {
  title: "个人设置",
};

export default async function StaffAccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const section = Array.isArray(params.section) ? params.section[0] : params.section;
  return (
    <AccountSettingsView
      heading={<StaffPageHeading title="个人设置" />}
      initialSection={section}
    />
  );
}
