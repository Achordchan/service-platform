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
  InputAdornment,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import SearchOutlinedIcon from "@mui/icons-material/SearchOutlined";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { CreateCustomerSpaceDialog } from "@/components/staff/create-customer-space-dialog";
import { AccountEmailChangeDialog } from "@/components/staff/account-email-change-dialog";
import { DeletionPreflightDialog } from "@/components/shared/deletion-preflight-dialog";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";
import type { CustomerSpaceItem } from "@/components/staff/staff-types";

const statusLabels = {
  ACTIVE: "启用",
  SUSPENDED: "已暂停",
  ARCHIVED: "已归档",
};

export function CustomerSpaceTable({
  spaces,
}: {
  spaces: CustomerSpaceItem[];
}) {
  const router = useRouter();
  const [keyword, setKeyword] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerSpaceItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] =
    useState<CustomerSpaceItem | null>(null);
  const [emailTarget, setEmailTarget] =
    useState<CustomerSpaceItem | null>(null);
  const [created, setCreated] = useState<{
    name: string;
    previewUrl?: string;
  } | null>(null);
  const rows = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    return spaces.filter(
      (space) =>
        !normalized ||
        space.name.toLowerCase().includes(normalized) ||
        space.ownerName.toLowerCase().includes(normalized) ||
        space.ownerEmail.toLowerCase().includes(normalized),
    );
  }, [keyword, spaces]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const data = new FormData(event.currentTarget);
    setSubmitting(true);
    setError("");
    try {
      await staffApi(
        `/api/v1/admin/customer-spaces/${editing.id}`,
        jsonRequest("PATCH", {
          name: String(data.get("name") ?? "").trim(),
          memberLimit: Number(data.get("memberLimit")),
          status: String(data.get("status") ?? editing.status),
        }),
      );
      setEditing(null);
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "客户更新失败",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function removeSpace(space: CustomerSpaceItem) {
    setEditing(null);
    setDeleteTarget(space);
  }

  const columns = useMemo<GridColDef<CustomerSpaceItem>[]>(
    () => [
      { field: "name", headerName: "客户", minWidth: 180, flex: 1 },
      { field: "slug", headerName: "空间标识", minWidth: 150, flex: 0.8 },
      {
        field: "owner",
        headerName: "负责人",
        minWidth: 210,
        flex: 1,
        valueGetter: (_value, row) => `${row.ownerName} ${row.ownerEmail}`,
        display: "flex",
        renderCell: ({ row }) => (
          <Box sx={{ lineHeight: 1.35, minWidth: 0, width: "100%" }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
              {row.ownerName}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              noWrap
              sx={{ display: "block" }}
            >
              {row.ownerEmail}
            </Typography>
            {row.pendingEmailChange ? (
              <Typography
                variant="caption"
                color="warning.main"
                noWrap
                sx={{ display: "block" }}
              >
                待验证：{row.pendingEmailChange.newEmail}
              </Typography>
            ) : null}
          </Box>
        ),
      },
      {
        field: "members",
        headerName: "成员",
        minWidth: 110,
        display: "flex",
        valueGetter: (_value, row) => `${row.memberCount} / ${row.memberLimit}`,
        renderCell: ({ row }) => `${row.memberCount} / ${row.memberLimit}`,
      },
      { field: "projectCount", headerName: "项目数", minWidth: 100 },
      {
        field: "status",
        headerName: "状态",
        minWidth: 110,
        renderCell: ({ row }) => statusLabels[row.status],
      },
      {
        field: "actions",
        headerName: "操作",
        sortable: false,
        filterable: false,
        minWidth: 180,
        display: "flex",
        renderCell: ({ row }) => (
          <Stack direction="row" spacing={0.5}>
            <Button
              size="small"
              startIcon={<EditOutlinedIcon />}
              onClick={(event) => {
                event.stopPropagation();
                setEditing(row);
              }}
            >
              编辑
            </Button>
            <Button
              size="small"
              color="inherit"
              startIcon={<DeleteOutlinedIcon />}
              disabled={submitting}
              onClick={(event) => {
                event.stopPropagation();
                removeSpace(row);
              }}
            >
              删除
            </Button>
          </Stack>
        ),
      },
    ],
    [submitting],
  );

  return (
    <Stack spacing={2}>
      {error && !editing ? <Alert severity="error" onClose={() => setError("")}>{error}</Alert> : null}
      {created ? (
        <Alert
          severity="success"
          onClose={() => setCreated(null)}
          action={
            created.previewUrl ? (
              <Button
                component="a"
                href={created.previewUrl}
                target="_blank"
                rel="noreferrer"
                color="inherit"
                size="small"
              >
                打开邀请
              </Button>
            ) : undefined
          }
        >
          {created.name}已创建，负责人邀请已加入发送队列。
        </Alert>
      ) : null}
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        sx={{ justifyContent: "space-between" }}
      >
        <TextField
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="搜索客户、所有者或邮箱"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchOutlinedIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
          sx={{ width: { xs: "100%", sm: 360 } }}
        />
        <Button
          variant="contained"
          startIcon={<AddOutlinedIcon />}
          onClick={() => setCreateOpen(true)}
        >
          新建客户
        </Button>
      </Stack>
      <Paper variant="outlined" sx={{ overflow: "hidden" }}>
        <Box
          sx={{
            display: { xs: "none", md: "block" },
            width: "100%",
            minHeight: 520,
            height: { md: "min(70vh, 720px)" },
          }}
        >
          <DataGrid
            rows={rows}
            columns={columns}
            getRowHeight={() => 68}
            getRowId={(row) => row.id}
            pageSizeOptions={[10, 20, 50]}
            initialState={{
              pagination: { paginationModel: { pageSize: 10, page: 0 } },
            }}
            disableRowSelectionOnClick
            sx={{
              border: 0,
              "& .MuiDataGrid-cell": {
                display: "flex",
                alignItems: "center",
                py: 0.5,
              },
              "& .MuiDataGrid-columnHeader": {
                alignItems: "center",
              },
              "& .MuiDataGrid-columnHeaderTitle": {
                fontWeight: 650,
              },
            }}
          />
        </Box>
        <Stack sx={{ display: { xs: "flex", md: "none" } }}>
          {rows.map((space) => (
            <Stack
              key={space.id}
              spacing={1}
              sx={{
                p: 2,
                borderBottom: "1px solid",
                borderColor: "divider",
                "&:last-child": { borderBottom: 0 },
              }}
            >
              <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between" }}>
                <Typography sx={{ fontWeight: 650 }}>{space.name}</Typography>
                <Typography variant="body2">{statusLabels[space.status]}</Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {space.ownerName} · {space.ownerEmail}
              </Typography>
              {space.pendingEmailChange ? (
                <Chip
                  size="small"
                  color="warning"
                  variant="outlined"
                  label={`待验证 ${space.pendingEmailChange.newEmail}`}
                  sx={{ alignSelf: "flex-start", maxWidth: "100%" }}
                />
              ) : null}
              <Typography variant="body2" color="text.secondary">
                成员 {space.memberCount}/{space.memberLimit} · 项目 {space.projectCount}
              </Typography>
              <Stack direction="row" spacing={1}>
                <Button
                  variant="outlined"
                  startIcon={<EditOutlinedIcon />}
                  onClick={() => setEditing(space)}
                >
                  编辑
                </Button>
                <Button
                  variant="outlined"
                  color="inherit"
                  startIcon={<DeleteOutlinedIcon />}
                  disabled={submitting}
                  onClick={() => removeSpace(space)}
                >
                  删除
                </Button>
              </Stack>
            </Stack>
          ))}
        </Stack>
      </Paper>

      <Dialog
        open={Boolean(editing)}
        onClose={submitting ? undefined : () => setEditing(null)}
        fullWidth
        maxWidth="sm"
      >
        {editing ? (
          <Stack component="form" onSubmit={submit}>
            {submitting ? <LinearProgress /> : null}
            <DialogTitle>管理客户</DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ pt: 1 }}>
                {error ? <Alert severity="error">{error}</Alert> : null}
                <TextField
                  name="name"
                  label="客户名称"
                  defaultValue={editing.name}
                  required
                />
                <TextField
                  name="memberLimit"
                  label="成员上限"
                  type="number"
                  defaultValue={editing.memberLimit}
                  slotProps={{ htmlInput: { min: editing.memberCount, max: 100 } }}
                  required
                />
                <TextField
                  name="status"
                  label="空间状态"
                  select
                  defaultValue={editing.status}
                >
                  <MenuItem value="ACTIVE">启用</MenuItem>
                  <MenuItem value="SUSPENDED">暂停</MenuItem>
                  <MenuItem value="ARCHIVED">归档</MenuItem>
                </TextField>
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1}
                  sx={{ alignItems: { sm: "center" } }}
                >
                  <TextField
                    label="负责人登录邮箱"
                    value={editing.ownerEmail}
                    disabled
                    fullWidth
                  />
                  <Button
                    variant="outlined"
                    sx={{ flexShrink: 0 }}
                    onClick={() => {
                      setEmailTarget(editing);
                      setEditing(null);
                    }}
                  >
                    修改邮箱
                  </Button>
                </Stack>
                {editing.pendingEmailChange ? (
                  <Alert severity="warning">
                    新邮箱 {editing.pendingEmailChange.newEmail} 正在等待验证。
                  </Alert>
                ) : null}
                <Alert severity="info">
                  当前成员 {editing.memberCount} 人，成员上限不能低于当前人数。
                </Alert>
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 3, justifyContent: "space-between" }}>
              <Button
                color="inherit"
                disabled={submitting}
                onClick={() => removeSpace(editing)}
              >
                删除客户
              </Button>
              <Stack direction="row" spacing={1}>
                <Button onClick={() => setEditing(null)} disabled={submitting}>
                  取消
                </Button>
                <Button type="submit" variant="contained" disabled={submitting}>
                  保存
                </Button>
              </Stack>
            </DialogActions>
          </Stack>
        ) : null}
      </Dialog>

      <CreateCustomerSpaceDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(result) => {
          setCreateOpen(false);
          setCreated({
            name: result.name,
            previewUrl: result.previewUrl,
          });
          router.refresh();
        }}
      />
      <DeletionPreflightDialog
        target={
          deleteTarget
            ? {
                resourceType: "CUSTOMER_SPACE",
                resourceId: deleteTarget.id,
                resourceLabel: deleteTarget.name,
              }
            : null
        }
        deleteUrl={
          deleteTarget
            ? `/api/v1/admin/customer-spaces/${deleteTarget.id}`
            : null
        }
        onClose={() => setDeleteTarget(null)}
        onDeleted={() => {
          setDeleteTarget(null);
          router.refresh();
        }}
      />
      <AccountEmailChangeDialog
        key={emailTarget?.ownerId ?? "closed-email-change"}
        target={
          emailTarget
            ? {
                id: emailTarget.ownerId,
                name: emailTarget.ownerName,
                email: emailTarget.ownerEmail,
                pendingEmailChange: emailTarget.pendingEmailChange,
              }
            : null
        }
        onClose={() => setEmailTarget(null)}
        onChanged={() => router.refresh()}
      />
    </Stack>
  );
}
