import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveActor } from "@/lib/actor";
import { auth } from "@/lib/auth";

export async function getCurrentSession() {
  return auth.api.getSession({
    headers: await headers(),
  });
}

export async function requireSession() {
  const session = await getCurrentSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

export async function requireUserWithAccess() {
  const session = await requireSession();
  const actor = await resolveActor(session.user.id);
  if (!actor) {
    redirect("/login");
  }
  return { session, actor };
}

export async function requirePlatformAdmin() {
  const { session, actor } = await requireUserWithAccess();
  if (!actor.isPlatformAdmin) {
    redirect("/staff/projects");
  }
  return { session, actor };
}
