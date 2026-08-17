import { Stack } from "@mui/material";
import { PageContainer } from "@/components/shared/page-container";
import { CustomerSpaceTable } from "@/components/staff/customer-space-table";
import { StaffPageHeading } from "@/components/staff/staff-page-heading";
import type { CustomerSpaceItem } from "@/components/staff/staff-types";
import { requirePlatformAdmin } from "@/lib/session";
import { listCustomerSpaces } from "@/modules/customer-spaces/customer-space-service";

export const metadata = {
  title: "客户",
};

export default async function StaffCustomersPage() {
  const { actor } = await requirePlatformAdmin();
  const result = await listCustomerSpaces(actor);
  const spaces: CustomerSpaceItem[] = result.map((space) => ({
    id: space.id,
    name: space.name,
    slug: space.slug,
    memberLimit: space.memberLimit,
    status: space.status,
    ownerId: space.owner.id,
    ownerName: space.owner.name,
    ownerEmail: space.owner.email,
    pendingEmailChange: space.owner.emailChanges[0]
      ? {
          id: space.owner.emailChanges[0].id,
          newEmail: space.owner.emailChanges[0].newEmail,
          expiresAt: space.owner.emailChanges[0].expiresAt.toISOString(),
          lastSentAt: space.owner.emailChanges[0].lastSentAt.toISOString(),
          mailStatus: space.owner.emailChanges[0].mailStatus,
          mailDispatchFailed:
            space.owner.emailChanges[0].mailDispatchFailed,
        }
      : null,
    memberCount: space._count.memberships,
    projectCount: space._count.projects,
    updatedAt: space.updatedAt.toISOString(),
  }));

  return (
    <PageContainer>
      <Stack spacing={2.5}>
        <StaffPageHeading title="客户" />
        <CustomerSpaceTable spaces={spaces} />
      </Stack>
    </PageContainer>
  );
}
