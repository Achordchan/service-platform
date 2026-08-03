"use client";

import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
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
import ManageAccountsOutlinedIcon from "@mui/icons-material/ManageAccountsOutlined";
import SearchOutlinedIcon from "@mui/icons-material/SearchOutlined";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { CreateCustomerSpaceDialog } from "@/components/staff/create-customer-space-dialog";
import { CustomerAccountManagerDialog } from "@/components/staff/customer-account-manager-dialog";
import { DeletionPreflightDialog } from "@/components/shared/deletion-preflight-dialog";
import { useToast } from "@/components/shared/toast-provider";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";
import type { CustomerSpaceItem } from "@/components/staff/staff-types";

const statusLabels = {
  ACTIVE: "启用",
  SUSPENDED: "已暂停",
  ARCHIVED: "已归档",
};

const customerSpaceEditSchema = z.object({
  name: z.string().trim().min(1, "请填写客户名称").max(120),
  memberLimit: z.number().int().min(1).max(100),
  status: z.enum(["ACTIVE", "SUSPENDED", "ARCHIVED"]),
});

type CustomerSpaceEditValues = z.infer<typeof customerSpaceEditSchema>;

export function CustomerSpaceTable({
  spaces,
}: {
  spaces: CustomerSpaceItem[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [keyword, setKeyword] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerSpaceItem | null>(null);
  const editForm = useForm<CustomerSpaceEditValues>({
    resolver: zodResolver(customerSpaceEditSchema),
    defaultValues: { name: "", memberLimit: 1, status: "ACTIVE" },
  });
  const submitting = editForm.formState.isSubmitting;
  const [deleteTarget, setDeleteTarget] =
    useState<CustomerSpaceItem | null>(null);
  const [accountsTarget, setAccountsTarget] =
    useState<CustomerSpaceItem | null>(null);
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

  const submit = editForm.handleSubmit(async (values) => {
    if (!editing) return;
    if (values.memberLimit < editing.memberCount) {
      editForm.setError("memberLimit", {
        message: `成员上限不能低于当前账号数 ${editing.memberCount}`,
      });
      return;
    }
    try {
      await staffApi(
        `/api/v1/admin/customer-spaces/${editing.id}`,
        jsonRequest("PATCH", values),
      );
      setEditing(null);
      toast.success("客户资料已更新");
      router.refresh();
    } catch (submitError) {
      toast.error(
        submitError instanceof Error ? submitError.message : "客户更新失败",
      );
    }
  });

  function openEditor(space: CustomerSpaceItem) {
    editForm.reset({
      name: space.name,
      memberLimit: space.memberLimit,
      status: space.status,
    });
    setEditing(space);
  }

  function removeSpace(space: CustomerSpaceItem) {
    setEditing(null);
    setDeleteTarget(space);
  }

  const columns: GridColDef<CustomerSpaceItem>[] = [
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
        minWidth: 270,
        display: "flex",
        renderCell: ({ row }) => (
          <Stack direction="row" spacing={0.5}>
            <Button
              size="small"
              startIcon={<ManageAccountsOutlinedIcon />}
              onClick={(event) => {
                event.stopPropagation();
                setAccountsTarget(row);
              }}
            >
              账号
            </Button>
            <Button
              size="small"
              startIcon={<EditOutlinedIcon />}
              onClick={(event) => {
                event.stopPropagation();
                openEditor(row);
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
    ];

  return (
    <Stack spacing={2}>
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
              <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
                <Button
                  variant="outlined"
                  startIcon={<ManageAccountsOutlinedIcon />}
                  onClick={() => setAccountsTarget(space)}
                >
                  账号
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<EditOutlinedIcon />}
                  onClick={() => openEditor(space)}
                >
                  编辑
                </Button>
                <Button
                  variant="outlined"
                  color="inherit"
                  startIcon={<DeleteOutlinedIcon />}
                  disabled={editForm.formState.isSubmitting}
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
        onClose={editForm.formState.isSubmitting ? undefined : () => setEditing(null)}
        fullWidth
        maxWidth="sm"
      >
        {editing ? (
          <Stack component="form" onSubmit={submit}>
            {editForm.formState.isSubmitting ? <LinearProgress /> : null}
            <DialogTitle>管理客户</DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ pt: 1 }}>
                <Controller
                  name="name"
                  control={editForm.control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="客户名称"
                      required
                      error={Boolean(editForm.formState.errors.name)}
                      helperText={editForm.formState.errors.name?.message}
                    />
                  )}
                />
                <Controller
                  name="memberLimit"
                  control={editForm.control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="成员上限"
                      type="number"
                      onChange={(event) => field.onChange(Number(event.target.value))}
                      error={Boolean(editForm.formState.errors.memberLimit)}
                      helperText={editForm.formState.errors.memberLimit?.message}
                      slotProps={{ htmlInput: { min: editing.memberCount, max: 100 } }}
                      required
                    />
                  )}
                />
                <Controller
                  name="status"
                  control={editForm.control}
                  render={({ field }) => (
                    <TextField {...field} label="空间状态" select>
                      <MenuItem value="ACTIVE">启用</MenuItem>
                      <MenuItem value="SUSPENDED">暂停</MenuItem>
                      <MenuItem value="ARCHIVED">归档</MenuItem>
                    </TextField>
                  )}
                />
                <Alert severity="info">
                  当前共有 {editing.memberCount} 个客户账号。姓名、邮箱、负责人和普通成员请在“客户账号”中管理。
                </Alert>
                <Button
                  variant="outlined"
                  startIcon={<ManageAccountsOutlinedIcon />}
                  onClick={() => {
                    setAccountsTarget(editing);
                    setEditing(null);
                  }}
                >
                  管理客户账号
                </Button>
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 3, justifyContent: "space-between" }}>
              <Button
                color="inherit"
                disabled={editForm.formState.isSubmitting}
                onClick={() => removeSpace(editing)}
              >
                删除客户
              </Button>
              <Stack direction="row" spacing={1}>
                <Button onClick={() => setEditing(null)} disabled={editForm.formState.isSubmitting}>
                  取消
                </Button>
                <Button type="submit" variant="contained" disabled={editForm.formState.isSubmitting}>
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
          toast.show(`${result.name}已创建，负责人邀请已加入发送队列`, {
            severity: "success",
            action: result.previewUrl ? (
              <Button
                component="a"
                href={result.previewUrl}
                target="_blank"
                rel="noreferrer"
                color="inherit"
                size="small"
              >
                打开邀请
              </Button>
            ) : undefined,
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
          toast.success("客户已删除");
          setDeleteTarget(null);
          router.refresh();
        }}
      />
      <CustomerAccountManagerDialog
        target={accountsTarget}
        onClose={() => setAccountsTarget(null)}
        onChanged={() => router.refresh()}
      />
    </Stack>
  );
}
