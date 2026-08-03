"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AdminPanelSettingsOutlinedIcon from "@mui/icons-material/AdminPanelSettingsOutlined";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import EmailOutlinedIcon from "@mui/icons-material/EmailOutlined";
import PersonAddAltOutlinedIcon from "@mui/icons-material/PersonAddAltOutlined";
import { AccountEmailChangeDialog } from "@/components/staff/account-email-change-dialog";
import { useToast } from "@/components/shared/toast-provider";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";
import type { CustomerSpaceItem } from "@/components/staff/staff-types";
import { queryKeys } from "@/lib/query-keys";

const memberNameSchema = z.object({
  name: z.string().trim().min(2, "姓名至少需要 2 个字符").max(60),
});
const customerInvitationSchema = z.object({
  email: z.email("请输入有效邮箱").trim().toLowerCase(),
});

type MemberNameValues = z.infer<typeof memberNameSchema>;
type CustomerInvitationValues = z.infer<typeof customerInvitationSchema>;

type PendingEmailChange = {
  id: string;
  newEmail: string;
  expiresAt: string;
  lastSentAt: string;
  mailStatus: string | null;
  mailDispatchFailed: boolean;
};

type CustomerMembership = {
  id: string;
  role: "OWNER" | "MEMBER";
  createdAt: string;
  user: {
    id: string;
    name: string;
    email: string;
    emailChanges: Array<{
      id: string;
      newEmail: string;
      expiresAt: string;
      lastSentAt: string;
      mailStatus: string | null;
      mailDispatchFailed: boolean;
    }>;
  };
};

type CustomerSpaceDetail = {
  id: string;
  name: string;
  ownerId: string;
  memberLimit: number;
  memberships: CustomerMembership[];
  invitations: Array<{
    id: string;
    email: string;
    expiresAt: string;
    acceptedAt: string | null;
    revokedAt: string | null;
  }>;
};

function pendingEmailChange(member: CustomerMembership): PendingEmailChange | null {
  const change = member.user.emailChanges[0];
  return change
    ? change
    : null;
}

export function CustomerAccountManagerDialog({
  target,
  onClose,
  onChanged,
}: {
  target: CustomerSpaceItem | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<CustomerMembership | null>(null);
  const [emailTarget, setEmailTarget] = useState<CustomerMembership | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomerMembership | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const editForm = useForm<MemberNameValues>({
    resolver: zodResolver(memberNameSchema),
    defaultValues: { name: "" },
  });
  const inviteForm = useForm<CustomerInvitationValues>({
    resolver: zodResolver(customerInvitationSchema),
    defaultValues: { email: "" },
  });
  const targetId = target?.id ?? "";
  const detailKey = queryKeys.customerSpaces.detail(targetId);
  const detailQuery = useQuery({
    queryKey: detailKey,
    queryFn: ({ signal }) =>
      staffApi<CustomerSpaceDetail>(
        `/api/v1/admin/customer-spaces/${targetId}`,
        { signal },
      ),
    enabled: Boolean(targetId),
  });
  const actionMutation = useMutation({
    mutationFn: ({ run }: { key: string; run: () => Promise<unknown> }) =>
      run(),
  });
  const busyKey = actionMutation.isPending
    ? (actionMutation.variables?.key ?? "action")
    : "";
  const detail = detailQuery.data?.id === targetId ? detailQuery.data : null;

  async function refreshDetail() {
    if (!targetId) return;
    await queryClient.invalidateQueries({ queryKey: detailKey });
  }

  async function execute<T>(
    key: string,
    run: () => Promise<T>,
    fallbackError: string,
  ): Promise<{ ok: true; value: T } | { ok: false }> {
    try {
      const value = (await actionMutation.mutateAsync({ key, run })) as T;
      return { ok: true, value };
    } catch (error) {
      toast.error(error instanceof Error ? error.message : fallbackError);
      return { ok: false };
    }
  }

  function closeManager() {
    onClose();
  }

  const activeInvitations = useMemo(
    () =>
      detail?.invitations.filter(
        (invitation) =>
          !invitation.acceptedAt &&
          !invitation.revokedAt &&
          new Date(invitation.expiresAt) > new Date(),
      ) ?? [],
    [detail],
  );

  const saveMemberName = editForm.handleSubmit(async ({ name }) => {
    if (!target || !editing) return;
    const result = await execute(
      `edit:${editing.id}`,
      () =>
        staffApi(
          `/api/v1/admin/customer-spaces/${target.id}/members/${editing.id}`,
          jsonRequest("PATCH", { name }),
        ),
      "客户账号更新失败",
    );
    if (!result.ok) return;
    setEditing(null);
    toast.success("客户账号资料已更新");
    await refreshDetail();
    onChanged();
  });

  async function setOwner(member: CustomerMembership) {
    if (!target) return;
    const result = await execute(
      `owner:${member.id}`,
      () =>
        staffApi(
          `/api/v1/admin/customer-spaces/${target.id}`,
          jsonRequest("PATCH", { ownerId: member.user.id }),
        ),
      "负责人变更失败",
    );
    if (!result.ok) return;
    toast.success(`${member.user.name} 已设为客户负责人`);
    await refreshDetail();
    onChanged();
  }

  async function deleteMember() {
    if (!target || !deleteTarget) return;
    const result = await execute(
      `delete:${deleteTarget.id}`,
      () =>
        staffApi<{ accountDeleted: boolean }>(
          `/api/v1/admin/customer-spaces/${target.id}/members/${deleteTarget.id}`,
          jsonRequest("DELETE"),
        ),
      "客户账号删除失败",
    );
    if (!result.ok) return;
    setDeleteTarget(null);
    toast.success(
      result.value.accountDeleted
        ? "客户账号已删除并退出登录"
        : "成员已从当前客户移除，账号仍属于其他客户",
    );
    await refreshDetail();
    onChanged();
  }

  const sendInvitation = inviteForm.handleSubmit(async ({ email }) => {
    if (!target) return;
    const result = await execute(
      "invite",
      () =>
        staffApi(
          `/api/v1/admin/customer-spaces/${target.id}/invitations`,
          jsonRequest("POST", { email }),
        ),
      "客户邀请发送失败",
    );
    if (!result.ok) return;
    setInviteOpen(false);
    inviteForm.reset();
    toast.success("客户邀请已加入发件箱");
    await refreshDetail();
  });

  function openMemberEditor(member: CustomerMembership) {
    editForm.reset({ name: member.user.name });
    setEditing(member);
  }

  function openInvitation() {
    inviteForm.reset({ email: "" });
    setInviteOpen(true);
  }

  async function revokeInvitation(invitationId: string) {
    if (!target) return;
    const result = await execute(
      `invitation:${invitationId}`,
      () =>
        staffApi(
          `/api/v1/admin/customer-spaces/${target.id}/invitations/${invitationId}`,
          jsonRequest("DELETE"),
        ),
      "客户邀请撤销失败",
    );
    if (!result.ok) return;
    toast.success("客户邀请已撤销");
    await refreshDetail();
  }

  const capacityUsed =
    (detail?.memberships.length ?? 0) + activeInvitations.length;
  const visibleDetail = detail;
  const initialLoading = Boolean(target && detailQuery.isPending);

  return (
    <>
      <Dialog
        open={Boolean(target)}
        onClose={busyKey ? undefined : closeManager}
        fullWidth
        maxWidth="md"
        slotProps={{ paper: { sx: { maxHeight: "calc(100dvh - 48px)" } } }}
      >
        {detailQuery.isFetching || busyKey || initialLoading ? (
          <LinearProgress />
        ) : null}
        <DialogTitle>客户账号 · {target?.name}</DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          {visibleDetail ? (
            <Stack>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1.5}
                sx={{ px: 3, py: 2.25, justifyContent: "space-between" }}
              >
                <Box>
                  <Typography sx={{ fontWeight: 700 }}>
                    已使用 {capacityUsed}/{visibleDetail.memberLimit} 个账号名额
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    负责人和普通成员都属于当前客户；删除普通成员时会同步处理其登录账号。
                  </Typography>
                </Box>
                <Button
                  variant="contained"
                  startIcon={<PersonAddAltOutlinedIcon />}
                  disabled={capacityUsed >= visibleDetail.memberLimit || Boolean(busyKey)}
                  onClick={openInvitation}
                  sx={{ alignSelf: { xs: "stretch", sm: "center" }, flexShrink: 0 }}
                >
                  邀请成员
                </Button>
              </Stack>
              <Divider />
              <List disablePadding>
                {visibleDetail.memberships.map((member, index) => {
                  const owner = member.user.id === visibleDetail.ownerId;
                  return (
                    <ListItem
                      key={member.id}
                      divider={
                        index < visibleDetail.memberships.length - 1 ||
                        activeInvitations.length > 0
                      }
                      sx={{ px: 3, py: 1.75, gap: 2, alignItems: "center" }}
                      secondaryAction={
                        <Stack direction="row" spacing={0.25}>
                          {!owner ? (
                            <Tooltip title="设为负责人">
                              <span>
                                <IconButton
                                  size="small"
                                  aria-label={`将 ${member.user.name} 设为负责人`}
                                  disabled={Boolean(busyKey)}
                                  onClick={() => void setOwner(member)}
                                >
                                  <AdminPanelSettingsOutlinedIcon fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                          ) : null}
                          <Tooltip title="编辑姓名">
                            <span>
                              <IconButton
                                size="small"
                                aria-label={`编辑 ${member.user.name}`}
                                disabled={Boolean(busyKey)}
                                onClick={() => openMemberEditor(member)}
                              >
                                <EditOutlinedIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                          <Tooltip title="修改登录邮箱">
                            <span>
                              <IconButton
                                size="small"
                                aria-label={`修改 ${member.user.name} 的登录邮箱`}
                                disabled={Boolean(busyKey)}
                                onClick={() => setEmailTarget(member)}
                              >
                                <EmailOutlinedIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                          {!owner ? (
                            <Tooltip title="删除客户账号">
                              <span>
                                <IconButton
                                  size="small"
                                  color="error"
                                  aria-label={`删除 ${member.user.name}`}
                                  disabled={Boolean(busyKey)}
                                  onClick={() => setDeleteTarget(member)}
                                >
                                  <DeleteOutlineOutlinedIcon fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                          ) : null}
                        </Stack>
                      }
                    >
                      <ListItemText
                        sx={{ pr: 17, minWidth: 0 }}
                        primary={
                          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                            <Typography sx={{ fontWeight: 650, overflowWrap: "anywhere" }}>
                              {member.user.name}
                            </Typography>
                            <Chip
                              size="small"
                              color={owner ? "primary" : "default"}
                              variant={owner ? "filled" : "outlined"}
                              label={owner ? "负责人" : "普通成员"}
                            />
                          </Stack>
                        }
                        secondary={
                          <Typography
                            component="span"
                            variant="body2"
                            color="text.secondary"
                            sx={{ overflowWrap: "anywhere" }}
                          >
                            {member.user.email}
                            {member.user.emailChanges[0]
                              ? ` · 待验证 ${member.user.emailChanges[0].newEmail}`
                              : ""}
                          </Typography>
                        }
                      />
                    </ListItem>
                  );
                })}
              </List>
              {activeInvitations.length > 0 ? (
                <Stack spacing={1.25} sx={{ px: 3, py: 2.25 }}>
                  <Typography sx={{ fontWeight: 700 }}>待接受邀请</Typography>
                  {activeInvitations.map((invitation) => (
                    <Stack
                      key={invitation.id}
                      direction={{ xs: "column", sm: "row" }}
                      spacing={1}
                      sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ overflowWrap: "anywhere" }}>
                          {invitation.email}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          有效期至 {new Intl.DateTimeFormat("zh-CN", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }).format(new Date(invitation.expiresAt))}
                        </Typography>
                      </Box>
                      <Button
                        size="small"
                        color="inherit"
                        disabled={Boolean(busyKey)}
                        onClick={() => void revokeInvitation(invitation.id)}
                      >
                        撤销邀请
                      </Button>
                    </Stack>
                  ))}
                </Stack>
              ) : null}
            </Stack>
          ) : initialLoading ? null : (
            <Alert severity="error" sx={{ m: 3 }}>
              客户账号数据加载失败，请关闭后重试。
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={closeManager} disabled={Boolean(busyKey)}>
            关闭
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(editing)}
        onClose={busyKey ? undefined : () => setEditing(null)}
        fullWidth
        maxWidth="xs"
      >
        <Box component="form" onSubmit={saveMemberName}>
          <DialogTitle>编辑客户账号</DialogTitle>
          <DialogContent>
            <Controller
              name="name"
              control={editForm.control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="姓名"
                  required
                  fullWidth
                  autoFocus
                  sx={{ mt: 1 }}
                  error={Boolean(editForm.formState.errors.name)}
                  helperText={editForm.formState.errors.name?.message}
                  slotProps={{ htmlInput: { minLength: 2, maxLength: 60 } }}
                />
              )}
            />
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 3 }}>
            <Button onClick={() => setEditing(null)} disabled={Boolean(busyKey)}>
              取消
            </Button>
            <Button type="submit" variant="contained" disabled={Boolean(busyKey)}>
              保存
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <Dialog
        open={Boolean(deleteTarget)}
        onClose={busyKey ? undefined : () => setDeleteTarget(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>删除客户账号</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary">
            确认删除“{deleteTarget?.user.name}”？账号将从当前客户移除；若没有其他客户归属，其登录凭据和现有会话也会被清除。
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setDeleteTarget(null)} disabled={Boolean(busyKey)}>
            取消
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={Boolean(busyKey)}
            onClick={() => void deleteMember()}
          >
            确认删除
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={inviteOpen}
        onClose={busyKey ? undefined : () => setInviteOpen(false)}
        fullWidth
        maxWidth="xs"
      >
        <Box component="form" onSubmit={sendInvitation}>
          <DialogTitle>邀请客户成员</DialogTitle>
          <DialogContent>
            <Stack spacing={1.5} sx={{ mt: 1 }}>
              <Controller
                name="email"
                control={inviteForm.control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="登录邮箱"
                    type="email"
                    required
                    fullWidth
                    autoFocus
                    error={Boolean(inviteForm.formState.errors.email)}
                    helperText={inviteForm.formState.errors.email?.message}
                  />
                )}
              />
              <Typography variant="body2" color="text.secondary">
                每个客户账号只能属于一个客户，邀请链接 24 小时内有效。
              </Typography>
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 3 }}>
            <Button onClick={() => setInviteOpen(false)} disabled={Boolean(busyKey)}>
              取消
            </Button>
            <Button type="submit" variant="contained" disabled={Boolean(busyKey)}>
              发送邀请
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <AccountEmailChangeDialog
        key={emailTarget?.user.id ?? "closed-customer-member-email"}
        target={
          emailTarget
            ? {
                id: emailTarget.user.id,
                name: emailTarget.user.name,
                email: emailTarget.user.email,
                pendingEmailChange: pendingEmailChange(emailTarget),
              }
            : null
        }
        onClose={() => setEmailTarget(null)}
        onChanged={() => {
          setEmailTarget(null);
          void refreshDetail();
          onChanged();
        }}
      />
    </>
  );
}
