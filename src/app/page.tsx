import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/session";

export default async function Home() {
  const session = await getCurrentSession();
  redirect(session ? "/dashboard" : "/login");
}
