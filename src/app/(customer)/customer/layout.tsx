import { redirect } from "next/navigation";
import { CustomerShell } from "@/components/customer/customer-shell";
import { prisma } from "@/lib/db";
import { requireUserWithAccess } from "@/lib/session";
import { listCustomerSpacesForMember } from "@/modules/customer-spaces/customer-member-service";

export default async function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session, actor } = await requireUserWithAccess();
  const profile = await prisma.user.findUnique({
    where: { id: actor.id },
    select: {
      image: true,
      name: true,
      soundNotificationsEnabled: true,
      themePreference: true,
    },
  });
  if (actor.isStaff) {
    redirect("/staff/projects");
  }

  const memberships = await listCustomerSpacesForMember(actor);
  const spaces = memberships.map(({ role, customerSpace }) => ({
    id: customerSpace.id,
    name: customerSpace.name,
    role,
  }));

  return (
    <CustomerShell
      user={{
        id: actor.id,
        name: profile?.name ?? actor.name,
        email: actor.email,
        image: profile?.image ?? session.user.image,
        soundNotificationsEnabled:
          profile?.soundNotificationsEnabled ?? true,
        themePreference: profile?.themePreference ?? "SYSTEM",
      }}
      spaces={spaces}
    >
      {children}
    </CustomerShell>
  );
}
