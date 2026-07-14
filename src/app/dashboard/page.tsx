import { redirect } from "next/navigation";
import { requireUserWithAccess } from "@/lib/session";

export default async function DashboardPage() {
  const { actor } = await requireUserWithAccess();
  redirect(actor.isStaff ? "/staff/projects" : "/customer/projects");
}
