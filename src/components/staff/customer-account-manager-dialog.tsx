"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  const [detail, setDetail] = useState<CustomerSpaceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [failedTargetId, setFailedTargetId] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [editing, setEditing] = useState<CustomerMembership | null>(null);
  const [emailTarget, setEmailTarget] = useState<CustomerMembership | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomerMembership | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");

  const loadDetail = useCallback(async () => {
    if (!target) return;
    setLoading(true);
    try {
      const next = await staffApi<CustomerSpaceDetail>(
        `/api/v1/admin/customer-spaces/${target.id}`,
      );
      setDetail(next);
      setFailedTargetId("");
    } catch (error) {
      setFailedTargetId(target.id);
      toast.error(error instanceof Error ? error.message : "客户账号加载失败");
    } finally {
      setLoading(false);
    }
  }, [target, toast]);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    staffApi<CustomerSpaceDetail>(
      `/api/v1/admin/customer-spaces/${target.id}`,
    )
      .then((next) => {
        if (cancelled) return;
        setDetail(next);
        setFailedTargetId("");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFailedTargetId(target.id);
        toast.error(error instanceof Error ? error.message : "客户账号加载失败");
      });
    return () => {
      cancelled = true;
    };
  }, [target, toast]);

  function closeManager() {
    setDetail(null);
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

  async function saveMemberName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target || !editing) return;
    const data = new FormData(event.currentTarget);
    setBusyKey(`edit:${editing.id}`);
    try {
      await staffApi(
        `/api/v1/admin/customer-spaces/${target.id}/members/${editing.id}`,
        jsonRequest("PATCH", {
          name: String(data.get("name") ?? "").trim(),
        }),
      );
      setEditing(null);
      toast.success("客户账号资料已更新");
      await loadDetail();
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "客户账号更新失败");
    } finally {
      setBusyKey("");
    }
  }

  async function setOwner(member: CustomerMembership) {
    if (!target) return;
    setBusyKey(`owner:${member.id}`);
    try {
      await staffApi(
        `/api/v1/admin/customer-spaces/${target.id}`,
        jsonRequest("PATCH", { ownerId: member.user.id }),
      );
      toast.success(`${member.user.name} 已设为客户负责人`);
      await loadDetail();
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "负责人变更失败");
    } finally {
      setBusyKey("");
    }
  }

  async function deleteMember() {
    if (!target || !deleteTarget) return;
    setBusyKey(`delete:${deleteTarget.id}`);
    try {
      const result = await staffApi<{ accountDeleted: boolean }>(
        `/api/v1/admin/customer-spaces/${target.id}/members/${deleteTarget.id}`,
        jsonRequest("DELETE"),
      );
      setDeleteTarget(null);
      toast.success(
        result.accountDeleted
          ? "客户账号已删除并退出登录"
          : "成员已从当前客户移除，账号仍属于其他客户",
      );
      await loadDetail();
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "客户账号删除失败");
    } finally {
      setBusyKey("");
    }
  }

  async function sendInvitation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target) return;
    setBusyKey("invite");
    try {
      await staffApi(
        `/api/v1/admin/customer-spaces/${target.id}/invitations`,
        jsonRequest("POST", { email: inviteEmail.trim().toLowerCase() }),
      );
      setInviteOpen(false);
      setInviteEmail("");
      toast.success("客户邀请已加入发件箱");
      await loadDetail();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "客户邀请发送失败");
    } finally {
      setBusyKey("");
    }
  }

  async function revokeInvitation(invitationId: string) {
    if (!target) return;
    setBusyKey(`invitation:${invitationId}`);
    try {
      await staffApi(
        `/api/v1/admin/customer-spaces/${target.id}/invitations/${invitationId}`,
        jsonRequest("DELETE"),
      );
      toast.success("客户邀请已撤销");
      await loadDetail();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "客户邀请撤销失败");
    } finally {
      setBusyKey("");
    }
  }

  const capacityUsed =
    (detail?.memberships.length ?? 0) + activeInvitations.length;
  const visibleDetail = detail?.id === target?.id ? detail : null;
  const initialLoading = Boolean(
    target && !visibleDetail && failedTargetId !== target.id,
  );

  return (
    <>
      <Dialog
        open={Boolean(target)}
        onClose={busyKey ? undefined : closeManager}
        fullWidth
        maxWidth="md"
        slotProps={{ paper: { sx: { maxHeight: "calc(100dvh - 48px)" } } }}
      >
        {loading || busyKey || initialLoading ? <LinearProgress /> : null}
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
                  onClick={() => setInviteOpen(true)}
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
                                onClick={() => setEditing(member)}
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
            <TextField
              name="name"
              label="姓名"
              defaultValue={editing?.user.name}
              required
              fullWidth
              autoFocus
              sx={{ mt: 1 }}
              slotProps={{ htmlInput: { minLength: 2, maxLength: 60 } }}
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
              <TextField
                label="登录邮箱"
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                required
                fullWidth
                autoFocus
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
          void loadDetail();
          onChanged();
        }}
      />
    </>
  );
}
