import { redirect } from "next/navigation";
import { Container, Stack } from "@mui/material";
import {
  TeamManager,
  type RoleGroupOption,
  type StaffInviteView,
  type TeamMemberView,
} from "@/components/staff/team-manager";
import { StaffPageHeading } from "@/components/staff/staff-page-heading";
import { requireUserWithAccess } from "@/lib/session";
import { listRoleGroups } from "@/modules/users/role-group-service";
import {
  listInternalUsers,
  listStaffInvitations,
} from "@/modules/users/staff-invitation-service";

export const metadata = {
  title: "团队成员",
};

export default async function StaffTeamPage() {
  const { actor } = await requireUserWithAccess();
  if (!actor.isPlatformAdmin) {
    redirect("/staff/projects");
  }

  const [users, invitations, roleGroups] = await Promise.all([
    listInternalUsers(actor),
    listStaffInvitations(actor),
    listRoleGroups(actor, { activeOnly: true }),
  ]);

  const members: TeamMemberView[] = users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    platformRole: user.platformRole as TeamMemberView["platformRole"],
    phone: user.phone,
    company: user.company,
    jobTitle: user.jobTitle,
    wechat: user.wechat,
    website: user.website,
    location: user.location,
    contactNotes: user.contactNotes,
    roleGroupId: user.roleGroupId,
    roleGroupName: user.roleGroup?.name ?? null,
    projectCount: user._count.projectAssignments,
    createdAt: user.createdAt.toISOString(),
  }));

  const invitationViews: StaffInviteView[] = invitations.map((invitation) => ({
    id: invitation.id,
    email: invitation.email,
    name: invitation.name,
    phone: invitation.phone,
    company: invitation.company,
    jobTitle: invitation.jobTitle,
    wechat: invitation.wechat,
    location: invitation.location,
    platformRole: invitation.platformRole as StaffInviteView["platformRole"],
    roleGroupId: invitation.roleGroupId,
    roleGroupName: invitation.roleGroup?.name ?? null,
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
    invitedByName: invitation.invitedBy.name,
  }));

  const roleGroupOptions: RoleGroupOption[] = roleGroups.map((group) => ({
    id: group.id,
    name: group.name,
    accessLevel: group.accessLevel,
    active: group.active,
  }));

  return (
    <Container
      maxWidth={false}
      sx={{ px: { xs: 2, md: 3.5 }, py: { xs: 3, md: 4 } }}
    >
      <Stack spacing={3}>
        <StaffPageHeading
          title="团队成员"
          description="维护外包与内部协作人员资料，邀请后分配到具体项目"
        />
        <TeamManager
          members={members}
          invitations={invitationViews}
          roleGroups={roleGroupOptions}
        />
      </Stack>
    </Container>
  );
}
