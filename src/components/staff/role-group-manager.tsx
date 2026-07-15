"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";
import { ROLE_PERMISSION_OPTIONS } from "@/modules/users/role-permissions";

export type RoleGroupView = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  accessLevel: "PROJECT_MANAGER" | "TECHNICIAN";
  permissions: string[];
  isSystem: boolean;
  active: boolean;
  sortOrder: number;
  userCount: number;
  invitationCount: number;
  updatedAt: string;
};

const emptyForm = {
  name: "",
  key: "",
  description: "",
  accessLevel: "TECHNICIAN" as "PROJECT_MANAGER" | "TECHNICIAN",
  permissions: [] as string[],
  active: true,
  sortOrder: 60,
};

export function RoleGroupManager({
  roleGroups,
  embedded = false,
  showHeading = false,
}: {
  roleGroups: RoleGroupView[];
  embedded?: boolean;
  showHeading?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RoleGroupView | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const permissionOptions = useMemo(() => {
    if (form.accessLevel === "TECHNICIAN") {
      return ROLE_PERMISSION_OPTIONS.filter(
        (item) =>
          ![
            "project.manage_delivery",
            "project.manage_staff",
            "request.assign",
            "request.view_project",
            "update.publish",
          ].includes(item.key),
      );
    }
    return ROLE_PERMISSION_OPTIONS;
  }, [form.accessLevel]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setError("");
    setOpen(true);
  }

  function openEdit(group: RoleGroupView) {
    setEditing(group);
    setForm({
      name: group.name,
      key: group.key,
      description: group.description ?? "",
      accessLevel: group.accessLevel,
      permissions: group.permissions,
      active: group.active,
      sortOrder: group.sortOrder,
    });
    setError("");
    setOpen(true);
  }

  function togglePermission(key: string) {
    setForm((current) => {
      const exists = current.permissions.includes(key);
      return {
        ...current,
        permissions: exists
          ? current.permissions.filter((item) => item !== key)
          : [...current.permissions, key],
      };
    });
  }

  async function save() {
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      if (editing) {
        await staffApi(
          `/api/v1/admin/role-groups/${editing.id}`,
          jsonRequest("PATCH", {
            name: form.name,
            key: editing.isSystem ? undefined : form.key || undefined,
            description: form.description,
            accessLevel: form.accessLevel,
            permissions: form.permissions,
            active: form.active,
            sortOrder: form.sortOrder,
          }),
        );
        setSuccess("角色组已更新");
      } else {
        await staffApi(
          "/api/v1/admin/role-groups",
          jsonRequest("POST", {
            name: form.name,
            key: form.key || undefined,
            description: form.description,
            accessLevel: form.accessLevel,
            permissions: form.permissions,
            active: form.active,
            sortOrder: form.sortOrder,
          }),
        );
        setSuccess("角色组已创建");
      }
      setOpen(false);
      setEditing(null);
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(group: RoleGroupView) {
    if (group.isSystem) return;
    setSubmitting(true);
    setError("");
    try {
      await staffApi(`/api/v1/admin/role-groups/${group.id}`, {
        method: "DELETE",
      });
      setSuccess("角色组已删除");
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
    <Stack spacing={2}>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {success ? <Alert severity="success">{success}</Alert> : null}
      <Paper
        variant="outlined"
        sx={{
          p: embedded ? 0 : { xs: 2.25, md: 3 },
          border: embedded ? 0 : undefined,
        }}
      >
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          sx={{
            mb: 2,
            alignItems: { xs: "stretch", sm: "center" },
            justifyContent: "space-between",
          }}
        >
          {showHeading ? (
            <Box>
              <Typography sx={{ fontWeight: 700 }}>角色与权限</Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.5 }}
              >
                {roleGroups.length} 个角色组
              </Typography>
            </Box>
          ) : (
            <Box />
          )}
          <Button
            variant="contained"
            startIcon={<AddOutlinedIcon />}
            onClick={openCreate}
          >
            新增角色组
          </Button>
        </Stack>

        <Box sx={{ overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>角色组</TableCell>
                <TableCell>访问级别</TableCell>
                <TableCell>权限数</TableCell>
                <TableCell>成员</TableCell>
                <TableCell>状态</TableCell>
                <TableCell>操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {roleGroups.map((group) => (
                <TableRow key={group.id} hover>
                  <TableCell>
                    <Typography sx={{ fontWeight: 650 }}>{group.name}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {group.description || group.key}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {group.accessLevel === "PROJECT_MANAGER"
                      ? "项目负责人级"
                      : "技术人员级"}
                    {group.isSystem ? (
                      <Chip size="small" label="系统" sx={{ ml: 1 }} />
                    ) : null}
                  </TableCell>
                  <TableCell>{group.permissions.length}</TableCell>
                  <TableCell>
                    {group.userCount}
                    {group.invitationCount
                      ? ` / 邀请 ${group.invitationCount}`
                      : ""}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={group.active ? "success" : "default"}
                      label={group.active ? "启用" : "停用"}
                    />
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1}>
                      <Button size="small" onClick={() => openEdit(group)}>
                        编辑
                      </Button>
                      {!group.isSystem ? (
                        <Button
                          size="small"
                          color="inherit"
                          disabled={submitting}
                          onClick={() => remove(group)}
                        >
                          删除
                        </Button>
                      ) : null}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </Paper>

      <Dialog
        open={open}
        onClose={submitting ? undefined : () => setOpen(false)}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>{editing ? "编辑角色组" : "新增角色组"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <TextField
                label="名称"
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
                required
                fullWidth
              />
              <TextField
                label="标识"
                value={form.key}
                onChange={(event) =>
                  setForm((current) => ({ ...current, key: event.target.value }))
                }
                disabled={Boolean(editing?.isSystem)}
                helperText="小写字母、数字、下划线；可留空自动生成"
                fullWidth
              />
            </Stack>
            <TextField
              label="说明"
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              fullWidth
              multiline
              minRows={2}
            />
            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <TextField
                select
                label="访问级别"
                value={form.accessLevel}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    accessLevel: event.target.value as
                      | "PROJECT_MANAGER"
                      | "TECHNICIAN",
                    permissions: [],
                  }))
                }
                fullWidth
              >
                <MenuItem value="TECHNICIAN">技术人员级</MenuItem>
                <MenuItem value="PROJECT_MANAGER">项目负责人级</MenuItem>
              </TextField>
              <TextField
                label="排序"
                type="number"
                value={form.sortOrder}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    sortOrder: Number(event.target.value || 0),
                  }))
                }
                fullWidth
              />
            </Stack>
            <FormControlLabel
              control={
                <Switch
                  checked={form.active}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      active: event.target.checked,
                    }))
                  }
                />
              }
              label="启用该角色组"
            />
            <Box>
              <Typography sx={{ fontWeight: 650, mb: 1 }}>权限项</Typography>
              <FormGroup>
                {permissionOptions.map((item) => (
                  <FormControlLabel
                    key={item.key}
                    control={
                      <Checkbox
                        checked={form.permissions.includes(item.key)}
                        onChange={() => togglePermission(item.key)}
                      />
                    }
                    label={
                      <Box>
                        <Typography variant="body2">{item.label}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {item.description}
                        </Typography>
                      </Box>
                    }
                  />
                ))}
              </FormGroup>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={submitting}>
            取消
          </Button>
          <Button
            variant="contained"
            onClick={save}
            disabled={submitting || !form.name.trim()}
          >
            {submitting ? "保存中" : "保存"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
