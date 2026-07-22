import { redirect } from "next/navigation";
import { StaffShell } from "@/components/staff/staff-shell";
import type { StaffRole } from "@/components/staff/staff-types";
import { prisma } from "@/lib/db";
import { requireUserWithAccess } from "@/lib/session";

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session, actor } = await requireUserWithAccess();
  const profile = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { image: true, name: true, soundNotificationsEnabled: true },
  });
  if (!actor.isStaff) {
    redirect("/customer/projects");
  }

  return (
    <StaffShell
      user={{
        id: actor.id,
        name: profile?.name ?? actor.name,
        email: actor.email,
        image: profile?.image ?? session.user.image,
        role: actor.platformRole as StaffRole,
        soundNotificationsEnabled:
          profile?.soundNotificationsEnabled ?? true,
      }}
    >
      {children}
    </StaffShell>
  );
}
