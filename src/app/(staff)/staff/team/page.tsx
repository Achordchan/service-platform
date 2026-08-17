import { Stack } from "@mui/material";
import { PageContainer } from "@/components/shared/page-container";
import type {
  RoleGroupOption,
  StaffInviteView,
  TeamMemberView,
} from "@/components/staff/team-manager";
import type { RoleGroupView } from "@/components/staff/role-group-manager";
import { TeamWorkspace } from "@/components/staff/team-workspace";
import { StaffPageHeading } from "@/components/staff/staff-page-heading";
import { requirePlatformAdmin } from "@/lib/session";
import { listRoleGroups } from "@/modules/users/role-group-service";
import {
  listInternalUsers,
  listStaffInvitations,
} from "@/modules/users/staff-invitation-service";

export const metadata = {
  title: "团队",
};

export default async function StaffTeamPage() {
  const { actor } = await requirePlatformAdmin();

  const [users, invitations, roleGroups] = await Promise.all([
    listInternalUsers(actor),
    listStaffInvitations(actor),
    listRoleGroups(actor),
  ]);

  const members: TeamMemberView[] = users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    pendingEmailChange: user.emailChanges[0]
      ? {
          id: user.emailChanges[0].id,
          newEmail: user.emailChanges[0].newEmail,
          expiresAt: user.emailChanges[0].expiresAt.toISOString(),
          lastSentAt: user.emailChanges[0].lastSentAt.toISOString(),
          mailStatus: user.emailChanges[0].mailStatus,
          mailDispatchFailed: user.emailChanges[0].mailDispatchFailed,
        }
      : null,
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
    requestCount:
      user._count.requestsAssigned + user._count.requestAssignees,
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

  const roleGroupViews: RoleGroupView[] = roleGroups.map((group) => ({
    id: group.id,
    key: group.key,
    name: group.name,
    description: group.description,
    accessLevel: group.accessLevel,
    permissions: group.permissions,
    isSystem: group.isSystem,
    active: group.active,
    sortOrder: group.sortOrder,
    userCount: group._count.users,
    invitationCount: group._count.invitations,
    updatedAt: group.updatedAt.toISOString(),
  }));

  return (
    <PageContainer>
      <Stack spacing={2.5}>
        <StaffPageHeading title="团队" />
        <TeamWorkspace
          members={members}
          invitations={invitationViews}
          roleGroupOptions={roleGroupOptions}
          roleGroups={roleGroupViews}
        />
      </Stack>
    </PageContainer>
  );
}
