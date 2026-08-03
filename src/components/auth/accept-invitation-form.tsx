"use client";

import { Alert, Button, Stack, TextField, Typography } from "@mui/material";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { apiRequest, jsonRequest } from "@/lib/api-client";

const invitationFormSchema = z.object({
  name: z.string().trim().min(2, "姓名至少需要 2 个字符").max(60),
  password: z.string().min(10, "密码至少需要 10 个字符").max(128),
});

type InvitationFormValues = z.infer<typeof invitationFormSchema>;

export function AcceptInvitationForm({
  token,
  spaceName,
  email,
  defaultName = "",
  invalid = false,
  roleLabel,
  isStaff = false,
  company,
  jobTitle,
}: {
  token: string;
  spaceName?: string;
  email?: string;
  defaultName?: string;
  invalid?: boolean;
  roleLabel?: string;
  isStaff?: boolean;
  company?: string;
  jobTitle?: string;
}) {
  const router = useRouter();
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<InvitationFormValues>({
    resolver: zodResolver(invitationFormSchema),
    defaultValues: { name: defaultName, password: "" },
  });

  const submit = handleSubmit(async ({ name, password }) => {
    if (invalid || !token) return;
    try {
      const result = await apiRequest<{ accountExists: boolean }>(
        "/api/v1/invitations/accept",
        jsonRequest("POST", { token, name, password }),
        "邀请链接无效或已经过期",
      );
      router.replace(
        `/login?invitation=${result.accountExists ? "existing" : "accepted"}`,
      );
    } catch (error) {
      setError("root", {
        message:
          error instanceof Error &&
          error.message.startsWith("MEMBER_LIMIT_REACHED")
            ? "该客户空间的成员名额已满"
            : "邀请链接无效或已经过期",
      });
    }
  });

  if (invalid || !token) {
    return (
      <Alert severity="error">
        邀请不可用。请让管理员重新发送邀请，或确认链接是否完整。
      </Alert>
    );
  }

  return (
    <Stack component="form" onSubmit={submit} spacing={2.25}>
      {spaceName ? (
        <Alert severity="info" icon={false}>
          <Typography sx={{ fontWeight: 650 }}>{spaceName}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            受邀邮箱：{email}
            {roleLabel ? ` · ${roleLabel}` : ""}
          </Typography>
          {company || jobTitle ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {[company, jobTitle].filter(Boolean).join(" · ")}
            </Typography>
          ) : null}
        </Alert>
      ) : null}
      {errors.root?.message ? <Alert severity="error">{errors.root.message}</Alert> : null}
      <Controller
        name="name"
        control={control}
        render={({ field }) => (
          <TextField
            {...field}
            label="姓名"
            required
            error={Boolean(errors.name)}
            helperText={errors.name?.message ?? "将用于服务沟通与进度通知"}
          />
        )}
      />
      <TextField
        label="登录邮箱"
        value={email ?? ""}
        fullWidth
        disabled
      />
      <Controller
        name="password"
        control={control}
        render={({ field }) => (
          <TextField
            {...field}
            label="设置密码"
            type="password"
            error={Boolean(errors.password)}
            helperText={
              errors.password?.message ??
              "至少 10 个字符；若账号已存在，将保留原密码"
            }
            required
          />
        )}
      />
      <Button type="submit" variant="contained" disabled={isSubmitting}>
        {isSubmitting
          ? "正在加入"
          : isStaff
            ? "加入服务支持团队"
            : `加入${spaceName ? ` ${spaceName}` : "服务空间"}`}
      </Button>
    </Stack>
  );
}
