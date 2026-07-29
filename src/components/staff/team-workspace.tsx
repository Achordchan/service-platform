"use client";

import { useState } from "react";
import { Box, Tab, Tabs } from "@mui/material";
import {
  RoleGroupManager,
  type RoleGroupView,
} from "@/components/staff/role-group-manager";
import {
  TeamManager,
  type RoleGroupOption,
  type StaffInviteView,
  type TeamMemberView,
} from "@/components/staff/team-manager";

export function TeamWorkspace({
  members,
  invitations,
  roleGroupOptions,
  roleGroups,
}: {
  members: TeamMemberView[];
  invitations: StaffInviteView[];
  roleGroupOptions: RoleGroupOption[];
  roleGroups: RoleGroupView[];
}) {
  const [tab, setTab] = useState<"members" | "roles">("members");

  return (
    <>
      <Tabs value={tab} onChange={(_event, value) => setTab(value)}>
        <Tab value="members" label={`成员 ${members.length}`} />
        <Tab value="roles" label={`角色与权限 ${roleGroups.length}`} />
      </Tabs>
      <Box sx={{ pt: 2.5 }}>
        {tab === "members" ? (
          <TeamManager
            members={members}
            invitations={invitations}
            roleGroups={roleGroupOptions}
            onManageRoleGroups={() => setTab("roles")}
          />
        ) : (
          <RoleGroupManager roleGroups={roleGroups} />
        )}
      </Box>
    </>
  );
}
