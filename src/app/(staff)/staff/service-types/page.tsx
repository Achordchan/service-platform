import { redirect } from "next/navigation";

export const metadata = {
  title: "服务配置",
};

export default function StaffServiceTypesPage() {
  redirect("/staff/settings");
}
