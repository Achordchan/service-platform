"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import type { RoleGroupView } from "@/components/staff/role-group-manager";
import { ROLE_PERMISSION_OPTIONS } from "@/modules/users/role-permissions";

const roleGroupFormSchema = z.object({
  name: z.string().trim().min(2, "名称至少需要 2 个字符").max(60),
  key: z
    .string()
    .trim()
    .max(60)
    .refine(
      (value) => !value || (value.length >= 2 && /^[a-z0-9_]+$/.test(value)),
      "标识至少 2 个字符，且仅支持小写字母、数字和下划线",
    ),
  description: z.string().trim().max(300, "说明不能超过 300 个字符"),
  accessLevel: z.enum(["PROJECT_MANAGER", "TECHNICIAN"]),
  permissions: z.array(z.string()),
  active: z.boolean(),
  sortOrder: z
    .number()
    .int("排序必须是整数")
    .min(0, "排序不能小于 0")
    .max(9999, "排序不能大于 9999"),
});

export type RoleGroupFormValues = z.infer<typeof roleGroupFormSchema>;

function formValues(group: RoleGroupView | null): RoleGroupFormValues {
  return group
    ? {
        name: group.name,
        key: group.key,
        description: group.description ?? "",
        accessLevel: group.accessLevel,
        permissions: group.permissions,
        active: group.active,
        sortOrder: group.sortOrder,
      }
    : {
        name: "",
        key: "",
        description: "",
        accessLevel: "TECHNICIAN",
        permissions: [],
        active: true,
        sortOrder: 60,
      };
}

export function RoleGroupFormDialog({
  open,
  editing,
  submitting,
  onClose,
  onSubmit,
}: {
  open: boolean;
  editing: RoleGroupView | null;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (values: RoleGroupFormValues) => Promise<void>;
}) {
  const form = useForm<RoleGroupFormValues>({
    resolver: zodResolver(roleGroupFormSchema),
    defaultValues: formValues(editing),
  });
  const accessLevel = useWatch({ control: form.control, name: "accessLevel" });
  const permissions = useWatch({ control: form.control, name: "permissions" });
  const busy = submitting || form.formState.isSubmitting;
  const permissionOptions = useMemo(
    () =>
      accessLevel === "TECHNICIAN"
        ? ROLE_PERMISSION_OPTIONS.filter(
            (item) =>
              ![
                "project.manage_delivery",
                "project.manage_staff",
                "request.view_project",
                "update.publish",
              ].includes(item.key),
          )
        : ROLE_PERMISSION_OPTIONS,
    [accessLevel],
  );

  function togglePermission(key: string) {
    const exists = permissions.includes(key);
    form.setValue(
      "permissions",
      exists
        ? permissions.filter((item) => item !== key)
        : [...permissions, key],
      { shouldDirty: true, shouldValidate: true },
    );
  }

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      fullWidth
      maxWidth="md"
    >
      <Box component="form" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <DialogTitle>{editing ? "编辑角色组" : "新增角色组"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <Controller
                name="name"
                control={form.control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="名称"
                    required
                    fullWidth
                    error={Boolean(form.formState.errors.name)}
                    helperText={form.formState.errors.name?.message}
                    slotProps={{ htmlInput: { maxLength: 60 } }}
                  />
                )}
              />
              <Controller
                name="key"
                control={form.control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="标识"
                    disabled={Boolean(editing?.isSystem)}
                    error={Boolean(form.formState.errors.key)}
                    helperText={
                      form.formState.errors.key?.message ??
                      "小写字母、数字、下划线；可留空自动生成"
                    }
                    fullWidth
                    slotProps={{ htmlInput: { maxLength: 60 } }}
                  />
                )}
              />
            </Stack>
            <Controller
              name="description"
              control={form.control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="说明"
                  fullWidth
                  multiline
                  minRows={2}
                  error={Boolean(form.formState.errors.description)}
                  helperText={form.formState.errors.description?.message}
                  slotProps={{ htmlInput: { maxLength: 300 } }}
                />
              )}
            />
            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <Controller
                name="accessLevel"
                control={form.control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    select
                    label="访问级别"
                    onChange={(event) => {
                      field.onChange(event);
                      form.setValue("permissions", [], { shouldDirty: true });
                    }}
                    fullWidth
                  >
                    <MenuItem value="TECHNICIAN">技术人员级</MenuItem>
                    <MenuItem value="PROJECT_MANAGER">项目负责人级</MenuItem>
                  </TextField>
                )}
              />
              <Controller
                name="sortOrder"
                control={form.control}
                render={({ field }) => (
                  <TextField
                    label="排序"
                    type="number"
                    value={field.value}
                    onChange={(event) =>
                      field.onChange(Number(event.target.value || 0))
                    }
                    onBlur={field.onBlur}
                    name={field.name}
                    inputRef={field.ref}
                    fullWidth
                    error={Boolean(form.formState.errors.sortOrder)}
                    helperText={form.formState.errors.sortOrder?.message}
                    slotProps={{ htmlInput: { min: 0, max: 9999 } }}
                  />
                )}
              />
            </Stack>
            <Controller
              name="active"
              control={form.control}
              render={({ field }) => (
                <FormControlLabel
                  control={
                    <Switch
                      checked={field.value}
                      onChange={(_, checked) => field.onChange(checked)}
                    />
                  }
                  label="启用该角色组"
                />
              )}
            />
            <Box>
              <Typography sx={{ fontWeight: 650, mb: 1 }}>权限项</Typography>
              <FormGroup>
                {permissionOptions.map((item) => (
                  <FormControlLabel
                    key={item.key}
                    control={
                      <Checkbox
                        checked={permissions.includes(item.key)}
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
          <Button onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? "保存中" : "保存"}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
