"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import type {
  RoleGroupOption,
  TeamMemberView,
} from "@/components/staff/team-manager";

const teamMemberFormSchema = z.object({
  name: z.string().trim().min(2, "姓名至少需要 2 个字符").max(60),
  email: z.string().trim().email("请输入有效邮箱").max(160),
  roleGroupId: z.string().min(1, "请选择角色组"),
  phone: z.string().trim().max(40, "手机不能超过 40 个字符"),
  company: z.string().trim().max(120, "公司不能超过 120 个字符"),
  jobTitle: z.string().trim().max(80, "职位不能超过 80 个字符"),
  wechat: z.string().trim().max(80, "微信不能超过 80 个字符"),
  website: z.string().trim().max(200, "网站不能超过 200 个字符"),
  location: z.string().trim().max(120, "所在地不能超过 120 个字符"),
  contactNotes: z.string().trim().max(500, "备注不能超过 500 个字符"),
});
const editingTeamMemberFormSchema = teamMemberFormSchema.extend({
  email: z.string().trim().max(160),
});

export type TeamMemberFormValues = z.infer<typeof teamMemberFormSchema>;

function formValues(
  member: TeamMemberView | null,
  roleGroups: RoleGroupOption[],
): TeamMemberFormValues {
  return member
    ? {
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
      }
    : {
        name: "",
        email: "",
        roleGroupId: roleGroups[0]?.id ?? "",
        phone: "",
        company: "",
        jobTitle: "",
        wechat: "",
        website: "",
        location: "",
        contactNotes: "",
      };
}

export function TeamMemberFormDialog({
  open,
  editing,
  roleGroups,
  submitting,
  onClose,
  onSubmit,
  onChangeEmail,
  onDelete,
}: {
  open: boolean;
  editing: TeamMemberView | null;
  roleGroups: RoleGroupOption[];
  submitting: boolean;
  onClose: () => void;
  onSubmit: (values: TeamMemberFormValues) => Promise<void>;
  onChangeEmail: (member: TeamMemberView) => void;
  onDelete: (member: TeamMemberView) => void;
}) {
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down("sm"));
  const form = useForm<TeamMemberFormValues>({
    resolver: zodResolver(
      editing ? editingTeamMemberFormSchema : teamMemberFormSchema,
    ),
    defaultValues: formValues(editing, roleGroups),
  });
  const busy = submitting || form.formState.isSubmitting;

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      fullWidth
      maxWidth="md"
      fullScreen={mobile}
    >
      <Box component="form" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <DialogTitle>
          {editing ? "编辑协作成员资料" : "邀请协作成员"}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <Controller
                name="name"
                control={form.control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="姓名"
                    required
                    fullWidth
                    error={Boolean(form.formState.errors.name)}
                    helperText={form.formState.errors.name?.message}
                    slotProps={{ htmlInput: { maxLength: 60 } }}
                  />
                )}
              />
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1}
                sx={{ width: "100%" }}
              >
                <Controller
                  name="email"
                  control={form.control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="邮箱"
                      type="email"
                      required
                      fullWidth
                      disabled={Boolean(editing)}
                      error={Boolean(form.formState.errors.email)}
                      helperText={form.formState.errors.email?.message}
                      slotProps={{ htmlInput: { maxLength: 160 } }}
                    />
                  )}
                />
                {editing ? (
                  <Button
                    type="button"
                    variant="outlined"
                    sx={{ flexShrink: 0 }}
                    onClick={() => onChangeEmail(editing)}
                  >
                    修改邮箱
                  </Button>
                ) : null}
              </Stack>
            </Stack>
            <Controller
              name="roleGroupId"
              control={form.control}
              render={({ field }) => (
                <TextField
                  {...field}
                  select
                  label="角色组"
                  required
                  fullWidth
                  error={Boolean(form.formState.errors.roleGroupId)}
                  helperText={
                    form.formState.errors.roleGroupId?.message ??
                    "角色组决定协作权限；平台管理员不在邀请范围。"
                  }
                >
                  {roleGroups.map((group) => (
                    <MenuItem key={group.id} value={group.id}>
                      {group.name} ·{" "}
                      {group.accessLevel === "PROJECT_MANAGER"
                        ? "项目负责人级"
                        : "技术人员级"}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            />
            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <Controller
                name="phone"
                control={form.control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="手机"
                    fullWidth
                    error={Boolean(form.formState.errors.phone)}
                    helperText={form.formState.errors.phone?.message}
                    slotProps={{ htmlInput: { maxLength: 40 } }}
                  />
                )}
              />
              <Controller
                name="wechat"
                control={form.control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="微信"
                    fullWidth
                    error={Boolean(form.formState.errors.wechat)}
                    helperText={form.formState.errors.wechat?.message}
                    slotProps={{ htmlInput: { maxLength: 80 } }}
                  />
                )}
              />
            </Stack>
            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <Controller
                name="company"
                control={form.control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="公司/工作室"
                    fullWidth
                    error={Boolean(form.formState.errors.company)}
                    helperText={form.formState.errors.company?.message}
                    slotProps={{ htmlInput: { maxLength: 120 } }}
                  />
                )}
              />
              <Controller
                name="jobTitle"
                control={form.control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="职位"
                    fullWidth
                    error={Boolean(form.formState.errors.jobTitle)}
                    helperText={form.formState.errors.jobTitle?.message}
                    slotProps={{ htmlInput: { maxLength: 80 } }}
                  />
                )}
              />
            </Stack>
            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <Controller
                name="location"
                control={form.control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="所在地"
                    fullWidth
                    error={Boolean(form.formState.errors.location)}
                    helperText={form.formState.errors.location?.message}
                    slotProps={{ htmlInput: { maxLength: 120 } }}
                  />
                )}
              />
              <Controller
                name="website"
                control={form.control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="网站/主页"
                    fullWidth
                    error={Boolean(form.formState.errors.website)}
                    helperText={form.formState.errors.website?.message}
                    slotProps={{ htmlInput: { maxLength: 200 } }}
                  />
                )}
              />
            </Stack>
            <Controller
              name="contactNotes"
              control={form.control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="备注"
                  fullWidth
                  multiline
                  minRows={2}
                  error={Boolean(form.formState.errors.contactNotes)}
                  helperText={
                    form.formState.errors.contactNotes?.message ??
                    "可写对接范围、擅长业务、可用时段等"
                  }
                  slotProps={{ htmlInput: { maxLength: 500 } }}
                />
              )}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, justifyContent: "space-between" }}>
          {editing ? (
            <Button
              type="button"
              color="inherit"
              startIcon={<DeleteOutlinedIcon />}
              disabled={busy}
              onClick={() => onDelete(editing)}
            >
              删除成员
            </Button>
          ) : (
            <span />
          )}
          <Stack direction="row" spacing={1}>
            <Button type="button" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button type="submit" variant="contained" disabled={busy}>
              {busy ? "提交中" : editing ? "保存资料" : "发送邀请"}
            </Button>
          </Stack>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
