import { redirect } from "next/navigation";
import { Container, Stack } from "@mui/material";
import { CustomerSpaceTable } from "@/components/staff/customer-space-table";
import { StaffPageHeading } from "@/components/staff/staff-page-heading";
import type { CustomerSpaceItem } from "@/components/staff/staff-types";
import { requireUserWithAccess } from "@/lib/session";
import { listCustomerSpaces } from "@/modules/customer-spaces/customer-space-service";

export const metadata = {
  title: "客户空间",
};

export default async function StaffCustomersPage() {
  const { actor } = await requireUserWithAccess();
  if (!actor.isPlatformAdmin) {
    redirect("/staff/projects");
  }
  const result = await listCustomerSpaces(actor);
  const spaces: CustomerSpaceItem[] = result.map((space) => ({
    id: space.id,
    name: space.name,
    slug: space.slug,
    memberLimit: space.memberLimit,
    status: space.status,
    ownerName: space.owner.name,
    ownerEmail: space.owner.email,
    memberCount: space._count.memberships,
    projectCount: space._count.projects,
    updatedAt: space.updatedAt.toISOString(),
  }));

  return (
    <Container
      maxWidth={false}
      sx={{ px: { xs: 2, md: 3.5 }, py: { xs: 3, md: 4 } }}
    >
      <Stack spacing={3}>
        <StaffPageHeading
          title="客户空间"
          description="查看客户成员容量、项目数量和空间状态"
        />
        <CustomerSpaceTable spaces={spaces} />
      </Stack>
    </Container>
  );
}
