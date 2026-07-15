"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import PersonAddAltOutlinedIcon from "@mui/icons-material/PersonAddAltOutlined";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";

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

const emptyForm = {
  name: "",
  email: "",
  roleGroupId: "",
  phone: "",
  company: "",
  jobTitle: "",
  wechat: "",
  website: "",
  location: "",
  contactNotes: "",
};

export function TeamManager({
  members,
  invitations,
  roleGroups,
}: {
  members: TeamMemberView[];
  invitations: StaffInviteView[];
  roleGroups: RoleGroupOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TeamMemberView | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const activeRoleGroups = useMemo(
    () => roleGroups.filter((group) => group.active),
    [roleGroups],
  );

  function openInvite() {
    setError("");
    setForm({
      ...emptyForm,
      roleGroupId: activeRoleGroups[0]?.id ?? "",
    });
    setOpen(true);
  }

  function openEdit(member: TeamMemberView) {
    if (member.platformRole === "PLATFORM_ADMIN") return;
    setError("");
    setEditing(member);
    setForm({
      name: member.name,
      email: member.email,
      roleGroupId: member.roleGroupId ?? "",
      phone: member.phone ?? "",
      company: member.company ?? "",
      jobTitle: member.jobTitle ?? "",
      wechat: member.wechat ?? "",
      website: member.website ?? "",
      location: member.location ?? "",
      contactNotes: member.contactNotes ?? "",
    });
  }

  async function invite() {
    setSubmitting(true);
    setError("");
    setSuccess(null);
    setPreviewUrl(null);
    try {
      const result = await staffApi<StaffInviteView>(
        "/api/v1/admin/staff-invitations",
        jsonRequest("POST", form),
      );
      setOpen(false);
      setForm(emptyForm);
      setSuccess(
        `已邀请 ${result.email} 成为${result.roleGroupName || "协作成员"}`,
      );
      if (result.previewUrl) setPreviewUrl(result.previewUrl);
      router.refresh();
    } catch (inviteError) {
      setError(
        inviteError instanceof Error ? inviteError.message : "邀请失败",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function saveProfile() {
    if (!editing) return;
    setSubmitting(true);
    setError("");
    try {
      await staffApi(
        `/api/v1/admin/users/${editing.id}`,
        jsonRequest("PATCH", {
          name: form.name,
          roleGroupId: form.roleGroupId || null,
          phone: form.phone,
          company: form.company,
          jobTitle: form.jobTitle,
          wechat: form.wechat,
          website: form.website,
          location: form.location,
          contactNotes: form.contactNotes,
        }),
      );
      setEditing(null);
      setSuccess("成员资料已更新");
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(invitationId: string) {
    setSubmitting(true);
    setError("");
    try {
      await staffApi(`/api/v1/admin/staff-invitations/${invitationId}`, {
        method: "DELETE",
      });
      router.refresh();
    } catch (revokeError) {
      setError(
        revokeError instanceof Error ? revokeError.message : "撤销失败",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function removeMember(member: TeamMemberView) {
    if (member.platformRole === "PLATFORM_ADMIN") {
      setError("不能删除平台管理员");
      return;
    }
    if (member.projectCount > 0 || member.requestCount > 0) {
      setError("该成员仍有项目或工单分配，请先解除后再删除");
      return;
    }
    if (!window.confirm(`确认删除协作成员「${member.name}」？此操作不可恢复。`)) {
      return;
    }
    setSubmitting(true);
    setError("");
    setSuccess(null);
    try {
      await staffApi(
        `/api/v1/admin/users/${member.id}`,
        jsonRequest("DELETE"),
      );
      if (editing?.id === member.id) {
        setEditing(null);
      }
      setSuccess(`已删除协作成员 ${member.name}`);
      router.refresh();
    } catch (removeError) {
      setError(
        removeError instanceof Error ? removeError.message : "删除失败",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Stack spacing={3}>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {success ? (
        <Alert
          severity="success"
          action={
            previewUrl ? (
              <Button color="inherit" size="small" href={previewUrl}>
                打开邀请
              </Button>
            ) : undefined
          }
        >
          {success}
        </Alert>
      ) : null}

      <Paper variant="outlined" sx={{ p: { xs: 2.25, md: 3 } }}>
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

        {members.length === 0 ? (
          <Alert severity="info">暂无团队成员</Alert>
        ) : (
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>姓名</TableCell>
                  <TableCell>联系方式</TableCell>
                  <TableCell>公司/职位</TableCell>
                  <TableCell>角色组</TableCell>
                  <TableCell>项目</TableCell>
                  <TableCell>操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {members.map((member) => (
                  <TableRow key={member.id} hover>
                    <TableCell>
                      <Typography sx={{ fontWeight: 650 }}>
                        {member.name}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {member.email}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {member.phone || "—"}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {member.wechat ? `微信 ${member.wechat}` : "—"}
                      </Typography>
                      {member.location ? (
                        <Typography variant="caption" color="text.secondary">
                          {member.location}
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {member.company || "—"}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {member.jobTitle || "—"}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {member.platformRole === "PLATFORM_ADMIN" ? (
                        <Chip size="small" label="平台管理员" />
                      ) : (
                        <Chip
                          size="small"
                          label={member.roleGroupName || "未分配角色组"}
                        />
                      )}
                    </TableCell>
                    <TableCell>{member.projectCount}</TableCell>
                    <TableCell>
                      {member.platformRole === "PLATFORM_ADMIN" ? (
                        "—"
                      ) : (
                        <Stack direction="row" spacing={0.5}>
                          <Button size="small" onClick={() => openEdit(member)}>
                            编辑资料
                          </Button>
                          <Button
                            size="small"
                            color="inherit"
                            startIcon={<DeleteOutlinedIcon />}
                            disabled={
                              submitting ||
                              member.projectCount > 0 ||
                              member.requestCount > 0
                            }
                            onClick={() => void removeMember(member)}
                          >
                            删除
                          </Button>
                        </Stack>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Paper>

      {invitations.length > 0 ? (
        <Paper variant="outlined" sx={{ p: { xs: 2.25, md: 3 } }}>
          <Typography
            variant="h2"
            sx={{ mb: 2, fontSize: 20, fontWeight: 700 }}
          >
            待处理邀请
          </Typography>
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>姓名/邮箱</TableCell>
                  <TableCell>联系方式</TableCell>
                  <TableCell>角色组</TableCell>
                  <TableCell>过期时间</TableCell>
                  <TableCell>操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {invitations.map((invitation) => (
                  <TableRow key={invitation.id} hover>
                    <TableCell>
                      <Typography sx={{ fontWeight: 650 }}>
                        {invitation.name || "—"}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {invitation.email}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {invitation.phone || "—"}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {invitation.company || invitation.jobTitle || "—"}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {invitation.roleGroupName || "—"}
                    </TableCell>
                    <TableCell>
                      {new Date(invitation.expiresAt).toLocaleString("zh-CN")}
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1}>
                        {invitation.previewUrl ? (
                          <Button size="small" href={invitation.previewUrl}>
                            打开邀请
                          </Button>
                        ) : null}
                        <Button
                          size="small"
                          color="inherit"
                          disabled={submitting}
                          onClick={() => revoke(invitation.id)}
                        >
                          撤销
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Paper>
      ) : null}

      <Dialog
        open={open || Boolean(editing)}
        onClose={
          submitting
            ? undefined
            : () => {
                setOpen(false);
                setEditing(null);
              }
        }
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>
          {editing ? "编辑协作成员资料" : "邀请协作成员"}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <TextField
                label="姓名"
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
                required
                fullWidth
              />
              <TextField
                label="邮箱"
                type="email"
                value={form.email}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
                required
                fullWidth
                disabled={Boolean(editing)}
              />
            </Stack>
            <TextField
              select
              label="角色组"
              value={form.roleGroupId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  roleGroupId: event.target.value,
                }))
              }
              fullWidth
              helperText="角色组决定协作权限；平台管理员不在邀请范围。"
            >
              {activeRoleGroups.map((group) => (
                <MenuItem key={group.id} value={group.id}>
                  {group.name} ·{" "}
                  {group.accessLevel === "PROJECT_MANAGER"
                    ? "项目负责人级"
                    : "技术人员级"}
                </MenuItem>
              ))}
            </TextField>
            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <TextField
                label="手机"
                value={form.phone}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    phone: event.target.value,
                  }))
                }
                fullWidth
              />
              <TextField
                label="微信"
                value={form.wechat}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    wechat: event.target.value,
                  }))
                }
                fullWidth
              />
            </Stack>
            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <TextField
                label="公司/工作室"
                value={form.company}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    company: event.target.value,
                  }))
                }
                fullWidth
              />
              <TextField
                label="职位"
                value={form.jobTitle}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    jobTitle: event.target.value,
                  }))
                }
                fullWidth
              />
            </Stack>
            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <TextField
                label="所在地"
                value={form.location}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    location: event.target.value,
                  }))
                }
                fullWidth
              />
              <TextField
                label="网站/主页"
                value={form.website}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    website: event.target.value,
                  }))
                }
                fullWidth
              />
            </Stack>
            <TextField
              label="备注"
              value={form.contactNotes}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  contactNotes: event.target.value,
                }))
              }
              fullWidth
              multiline
              minRows={2}
              helperText="可写对接范围、擅长业务、可用时段等"
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, justifyContent: "space-between" }}>
          {editing ? (
            <Button
              color="inherit"
              startIcon={<DeleteOutlinedIcon />}
              disabled={
                submitting ||
                editing.projectCount > 0 ||
                editing.requestCount > 0
              }
              onClick={() => void removeMember(editing)}
            >
              删除成员
            </Button>
          ) : (
            <span />
          )}
          <Stack direction="row" spacing={1}>
            <Button
              onClick={() => {
                setOpen(false);
                setEditing(null);
              }}
              disabled={submitting}
            >
              取消
            </Button>
            <Button
              variant="contained"
              onClick={editing ? saveProfile : invite}
              disabled={
                submitting ||
                !form.name.trim() ||
                (!editing && !form.email.trim()) ||
                !form.roleGroupId
              }
            >
              {submitting ? "提交中" : editing ? "保存资料" : "发送邀请"}
            </Button>
          </Stack>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
