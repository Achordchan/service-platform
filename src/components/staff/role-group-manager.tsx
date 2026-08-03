"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  Button,
  Paper,
  Stack,
} from "@mui/material";
import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import { DeletionPreflightDialog } from "@/components/shared/deletion-preflight-dialog";
import { useToast } from "@/components/shared/toast-provider";
import {
  RoleGroupFormDialog,
  type RoleGroupFormValues,
} from "@/components/staff/role-group-form-dialog";
import { RoleGroupGrid } from "@/components/staff/role-group-grid";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";

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

export function RoleGroupManager({
  roleGroups,
  embedded = false,
}: {
  roleGroups: RoleGroupView[];
  embedded?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RoleGroupView | null>(null);
  const saveMutation = useMutation({
    mutationFn: (action: () => Promise<void>) => action(),
  });
  const submitting = saveMutation.isPending;
  const [deleteTarget, setDeleteTarget] =
    useState<RoleGroupView | null>(null);

  function openCreate() {
    setEditing(null);
    setOpen(true);
  }

  function openEdit(group: RoleGroupView) {
    setEditing(group);
    setOpen(true);
  }

  function closeDialog() {
    if (submitting) return;
    setOpen(false);
    setEditing(null);
  }

  async function save(values: RoleGroupFormValues) {
    try {
      await saveMutation.mutateAsync(async () => {
        if (editing) {
          await staffApi(
            `/api/v1/admin/role-groups/${editing.id}`,
            jsonRequest("PATCH", {
              name: values.name,
              key: editing.isSystem ? undefined : values.key || undefined,
              description: values.description,
              accessLevel: values.accessLevel,
              permissions: values.permissions,
              active: values.active,
              sortOrder: values.sortOrder,
            }),
          );
          toast.success("角色组已更新");
        } else {
          await staffApi(
            "/api/v1/admin/role-groups",
            jsonRequest("POST", {
              name: values.name,
              key: values.key || undefined,
              description: values.description,
              accessLevel: values.accessLevel,
              permissions: values.permissions,
              active: values.active,
              sortOrder: values.sortOrder,
            }),
          );
          toast.success("角色组已创建");
        }
        setOpen(false);
        setEditing(null);
        router.refresh();
      });
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : "保存失败");
    }
  }

  function remove(group: RoleGroupView) {
    setDeleteTarget(group);
  }

  return (
    <Stack spacing={2}>
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
            justifyContent: "flex-end",
          }}
        >
          <Button
            variant="contained"
            startIcon={<AddOutlinedIcon />}
            onClick={openCreate}
          >
            新增角色组
          </Button>
        </Stack>

        <RoleGroupGrid
          rows={roleGroups}
          submitting={submitting}
          onEdit={openEdit}
          onDelete={remove}
        />
      </Paper>

      <RoleGroupFormDialog
        key={editing ? `edit-${editing.id}` : open ? "create-open" : "closed"}
        open={open}
        editing={editing}
        submitting={submitting}
        onClose={closeDialog}
        onSubmit={save}
      />
      <DeletionPreflightDialog
        target={
          deleteTarget
            ? {
                resourceType: "ROLE_GROUP",
                resourceId: deleteTarget.id,
                resourceLabel: deleteTarget.name,
              }
            : null
        }
        deleteUrl={
          deleteTarget
            ? `/api/v1/admin/role-groups/${deleteTarget.id}`
            : null
        }
        onClose={() => setDeleteTarget(null)}
        onDeleted={() => {
          toast.success("角色组已删除");
          setDeleteTarget(null);
          router.refresh();
        }}
      />
    </Stack>
  );
}
