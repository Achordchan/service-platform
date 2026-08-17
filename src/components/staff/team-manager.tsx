"use client";

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  Alert,
  Button,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import PersonAddAltOutlinedIcon from "@mui/icons-material/PersonAddAltOutlined";
import { AccountEmailChangeDialog } from "@/components/staff/account-email-change-dialog";
import { DeletionPreflightDialog } from "@/components/shared/deletion-preflight-dialog";
import type { PendingEmailChange } from "@/components/shared/email-change-control";
import { useToast } from "@/components/shared/toast-provider";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";
import {
  TeamMemberFormDialog,
  type TeamMemberFormValues,
} from "@/components/staff/team-member-form-dialog";
import {
  StaffInvitationGrid,
  TeamMemberGrid,
} from "@/components/staff/team-management-grids";

export type RoleGroupOption = {
  id: string;
  name: string;
  accessLevel: "PROJECT_MANAGER" | "TECHNICIAN";
  active: boolean;
};

export type TeamMemberView = {
  id: string;
  name: string;
  email: string;
  pendingEmailChange: PendingEmailChange | null;
  platformRole: "PLATFORM_ADMIN" | "PROJECT_MANAGER" | "TECHNICIAN";
  phone: string | null;
  company: string | null;
  jobTitle: string | null;
  wechat: string | null;
  website: string | null;
  location: string | null;
  contactNotes: string | null;
  roleGroupId: string | null;
  roleGroupName: string | null;
  projectCount: number;
  requestCount: number;
  createdAt: string;
};

export type StaffInviteView = {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  company: string | null;
  jobTitle: string | null;
  wechat: string | null;
  location: string | null;
  platformRole: "PROJECT_MANAGER" | "TECHNICIAN";
  roleGroupId: string | null;
  roleGroupName: string | null;
  expiresAt: string;
  createdAt: string;
  invitedByName: string;
  previewUrl?: string;
};

export function TeamManager({
  members,
  invitations,
  roleGroups,
  onManageRoleGroups,
}: {
  members: TeamMemberView[];
  invitations: StaffInviteView[];
  roleGroups: RoleGroupOption[];
  onManageRoleGroups?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TeamMemberView | null>(null);
  const memberMutation = useMutation({
    mutationFn: (action: () => Promise<void>) => action(),
  });
  const submitting = memberMutation.isPending;
  const [deleteTarget, setDeleteTarget] =
    useState<TeamMemberView | null>(null);
  const [emailTarget, setEmailTarget] =
    useState<TeamMemberView | null>(null);

  const activeRoleGroups = useMemo(
    () => roleGroups.filter((group) => group.active),
    [roleGroups],
  );

  function openInvite() {
    setEditing(null);
    setOpen(true);
  }

  function openEdit(member: TeamMemberView) {
    if (member.platformRole === "PLATFORM_ADMIN") return;
    setOpen(false);
    setEditing(member);
  }

  function closeMemberDialog() {
    if (submitting) return;
    setOpen(false);
    setEditing(null);
  }

  async function submitMember(values: TeamMemberFormValues) {
    const target = editing;
    try {
      await memberMutation.mutateAsync(async () => {
        if (target) {
          await staffApi(
            `/api/v1/admin/users/${target.id}`,
            jsonRequest("PATCH", {
              name: values.name,
              roleGroupId: values.roleGroupId,
              phone: values.phone,
              company: values.company,
              jobTitle: values.jobTitle,
              wechat: values.wechat,
              website: values.website,
              location: values.location,
              contactNotes: values.contactNotes,
            }),
          );
          setEditing(null);
          toast.success("成员资料已更新");
        } else {
          const result = await staffApi<StaffInviteView>(
            "/api/v1/admin/staff-invitations",
            jsonRequest("POST", values),
          );
          setOpen(false);
          toast.show(
            `已邀请 ${result.email} 成为${result.roleGroupName || "协作成员"}`,
            {
              severity: "success",
              action: result.previewUrl ? (
                <Button color="inherit" size="small" href={result.previewUrl}>
                  打开邀请
                </Button>
              ) : undefined,
            },
          );
        }
        router.refresh();
      });
    } catch (submitError) {
      toast.error(
        submitError instanceof Error
          ? submitError.message
          : target
            ? "保存失败"
            : "邀请失败",
      );
    }
  }

  async function revoke(invitationId: string) {
    try {
      await memberMutation.mutateAsync(async () => {
        await staffApi(`/api/v1/admin/staff-invitations/${invitationId}`, {
          method: "DELETE",
        });
        toast.success("邀请已撤销");
        router.refresh();
      });
    } catch (revokeError) {
      toast.error(
        revokeError instanceof Error ? revokeError.message : "撤销失败",
      );
    }
  }

  function removeMember(member: TeamMemberView) {
    setOpen(false);
    setEditing(null);
    setDeleteTarget(member);
  }

  return (
    <Stack spacing={3}>

      <Paper variant="outlined" sx={{ p: { xs: 2.25, md: 3 } }}>
        {activeRoleGroups.length === 0 ? (
          <Alert
            severity="info"
            sx={{ mb: 2 }}
            action={
              onManageRoleGroups ? (
                <Button
                  color="inherit"
                  size="small"
                  onClick={onManageRoleGroups}
                >
                  去创建
                </Button>
              ) : undefined
            }
          >
            还没有启用的角色组，无法邀请成员。请先在「角色与权限」中创建一个角色组。
          </Alert>
        ) : null}

        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          sx={{
            mb: 2,
            alignItems: { xs: "stretch", sm: "center" },
            justifyContent: "flex-end",
          }}
        >
          <Button
            variant="contained"
            startIcon={<PersonAddAltOutlinedIcon />}
            onClick={openInvite}
            disabled={activeRoleGroups.length === 0}
          >
            邀请成员
          </Button>
        </Stack>

        <TeamMemberGrid
          rows={members}
          submitting={submitting}
          onEdit={openEdit}
          onDelete={removeMember}
        />
      </Paper>

      {invitations.length > 0 ? (
        <Paper variant="outlined" sx={{ p: { xs: 2.25, md: 3 } }}>
          <Typography
            variant="h2"
            sx={{ mb: 2, fontSize: 20, fontWeight: 650 }}
          >
            待处理邀请
          </Typography>
          <StaffInvitationGrid
            rows={invitations}
            submitting={submitting}
            onRevoke={revoke}
          />
        </Paper>
      ) : null}

      <TeamMemberFormDialog
        key={
          editing
            ? `edit-${editing.id}`
            : open
              ? "invite-open"
              : "closed"
        }
        open={open || Boolean(editing)}
        editing={editing}
        roleGroups={activeRoleGroups}
        submitting={submitting}
        onClose={closeMemberDialog}
        onSubmit={submitMember}
        onChangeEmail={(member) => {
          setEmailTarget(member);
          closeMemberDialog();
        }}
        onDelete={removeMember}
      />
      <DeletionPreflightDialog
        target={
          deleteTarget
            ? {
                resourceType: "STAFF_USER",
                resourceId: deleteTarget.id,
                resourceLabel: deleteTarget.name,
              }
            : null
        }
        deleteUrl={
          deleteTarget ? `/api/v1/admin/users/${deleteTarget.id}` : null
        }
        onClose={() => setDeleteTarget(null)}
        onDeleted={() => {
          toast.success(`已删除协作成员 ${deleteTarget?.name ?? ""}`);
          setDeleteTarget(null);
          router.refresh();
        }}
      />
      <AccountEmailChangeDialog
        key={emailTarget?.id ?? "closed-staff-email-change"}
        target={emailTarget}
        onClose={() => setEmailTarget(null)}
        onChanged={() => router.refresh()}
      />
    </Stack>
  );
}
