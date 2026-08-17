import { Stack } from "@mui/material";
import { PageContainer } from "@/components/shared/page-container";
import { MemberManagement } from "@/components/customer/member-management";
import { PageHeading } from "@/components/customer/page-heading";
import { requireUserWithAccess } from "@/lib/session";
import {
  getCustomerSpaceMembers,
  listCustomerSpacesForMember,
} from "@/modules/customer-spaces/customer-member-service";

export const metadata = {
  title: "成员",
};

export default async function CustomerMembersPage() {
  const { actor } = await requireUserWithAccess();
  const memberships = await listCustomerSpacesForMember(actor);
  const ownedSpaces = memberships.filter(({ role }) => role === "OWNER");
  const spaces = await Promise.all(
    ownedSpaces.map(({ customerSpace }) =>
      getCustomerSpaceMembers(actor, customerSpace.id),
    ),
  );

  return (
    <PageContainer maxWidth="lg">
      <Stack spacing={4}>
        <PageHeading title="成员" />
        <MemberManagement
          spaces={spaces.map((space) => ({
            id: space.id,
            name: space.name,
            memberLimit: space.memberLimit,
            members: space.memberships.map((membership) => ({
              id: membership.id,
              role: membership.role,
              name: membership.user.name,
              email: membership.user.email,
            })),
          }))}
        />
      </Stack>
    </PageContainer>
  );
}
