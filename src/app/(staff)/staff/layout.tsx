import { redirect } from "next/navigation";
import { StaffShell } from "@/components/staff/staff-shell";
import type { StaffRole } from "@/components/staff/staff-types";
import { prisma } from "@/lib/db";
import { withActorDb } from "@/lib/actor";
import { requireUserWithAccess } from "@/lib/session";

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session, actor } = await requireUserWithAccess();
  const [profile, contentRiskPlugin] = await Promise.all([
    prisma.user.findUnique({
      where: { id: actor.id },
      select: {
        image: true,
        name: true,
        soundNotificationsEnabled: true,
        themePreference: true,
      },
    }),
    actor.isPlatformAdmin
      ? withActorDb(actor, (tx) =>
          tx.pluginInstallation.findUnique({
            where: { key: "content-contact-risk" },
            select: { enabled: true },
          }),
        )
      : null,
  ]);
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
        themePreference: profile?.themePreference ?? "SYSTEM",
      }}
      contentReviewEnabled={contentRiskPlugin?.enabled === true}
    >
      {children}
    </StaffShell>
  );
}
