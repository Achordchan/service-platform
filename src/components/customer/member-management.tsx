"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import PersonAddAltOutlinedIcon from "@mui/icons-material/PersonAddAltOutlined";
import { useToast } from "@/components/shared/toast-provider";
import {
  jsonRequest,
  staffApi,
} from "@/components/staff/staff-api";

type SpaceMembers = {
  id: string;
  name: string;
  memberLimit: number;
  members: Array<{
    id: string;
    role: "OWNER" | "MEMBER";
    name: string;
    email: string;
  }>;
};

type DeleteTarget = {
  spaceId: string;
  member: SpaceMembers["members"][number];
};

const invitationFormSchema = z.object({
  email: z.string().trim().email("请输入有效的成员邮箱"),
});

type InvitationFormValues = z.infer<typeof invitationFormSchema>;

export function MemberManagement({ spaces }: { spaces: SpaceMembers[] }) {
  const router = useRouter();
  const toast = useToast();
  const [activeSpace, setActiveSpace] = useState<SpaceMembers | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const invitationForm = useForm<InvitationFormValues>({
    resolver: zodResolver(invitationFormSchema),
    defaultValues: { email: "" },
    mode: "onChange",
  });
  const invitationMutation = useMutation({
    mutationFn: ({ spaceId, email }: { spaceId: string; email: string }) =>
      staffApi(
        `/api/v1/admin/customer-spaces/${spaceId}/invitations`,
        jsonRequest("POST", { email }),
      ),
  });
  const removeMutation = useMutation({
    mutationFn: ({ spaceId, memberId }: { spaceId: string; memberId: string }) =>
      staffApi<{ accountDeleted: boolean }>(
        `/api/v1/admin/customer-spaces/${spaceId}/members/${memberId}`,
        { method: "DELETE" },
      ),
  });
  const sending = invitationMutation.isPending;
  const removingMemberId = removeMutation.isPending
    ? (removeMutation.variables?.memberId ?? null)
    : null;

  const sendInvitation = invitationForm.handleSubmit(async ({ email }) => {
    if (!activeSpace) return;
    try {
      await invitationMutation.mutateAsync({
        spaceId: activeSpace.id,
        email: email.trim(),
      });
      toast.success("邀请邮件已加入发送队列");
      setActiveSpace(null);
      invitationForm.reset({ email: "" });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "邀请发送失败",
      );
    }
  });

  async function removeMember() {
    if (!deleteTarget) return;
    try {
      const result = await removeMutation.mutateAsync({
        spaceId: deleteTarget.spaceId,
        memberId: deleteTarget.member.id,
      });
      setDeleteTarget(null);
      toast.success(
        result.accountDeleted
          ? "成员账号已删除并退出登录"
          : "成员已从当前客户移除",
      );
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "成员移除失败",
      );
    }
  }

  if (spaces.length === 0) {
    return <Alert severity="info">仅客户管理员可管理成员。</Alert>;
  }

  return (
    <Stack spacing={3}>
      {spaces.map((space) => {
        const isFull = space.members.length >= space.memberLimit;
        return (
          <Paper key={space.id} variant="outlined">
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={2}
              sx={{
                px: { xs: 2.5, md: 3 },
                py: 2.5,
                alignItems: { sm: "center" },
                justifyContent: "space-between",
              }}
            >
              <div>
                <Typography variant="h3">{space.name}</Typography>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 0.5 }}
                >
                  已使用 {space.members.length}/{space.memberLimit} 个成员名额
                </Typography>
              </div>
              <Button
                variant="contained"
                startIcon={<PersonAddAltOutlinedIcon />}
                disabled={isFull}
                onClick={() => {
                  setActiveSpace(space);
                  invitationForm.reset({ email: "" });
                }}
              >
                邀请成员
              </Button>
            </Stack>
            <Divider />
            <List disablePadding>
              {space.members.map((member, index) => (
                <ListItem
                  key={member.id}
                  divider={index < space.members.length - 1}
                  secondaryAction={
                    member.role === "MEMBER" ? (
                      <Button
                        color="inherit"
                        size="small"
                        disabled={removingMemberId !== null}
                        onClick={() =>
                          setDeleteTarget({ spaceId: space.id, member })
                        }
                      >
                        {removingMemberId === member.id ? "删除中" : "删除账号"}
                      </Button>
                    ) : null
                  }
                  sx={{ px: { xs: 2.5, md: 3 }, py: 1.5 }}
                >
                  <ListItemText
                    primary={member.name}
                    secondary={`${member.email} · ${
                      member.role === "OWNER" ? "管理员" : "成员"
                    }`}
                  />
                </ListItem>
              ))}
            </List>
          </Paper>
        );
      })}

      <Dialog
        open={Boolean(activeSpace)}
        onClose={sending ? undefined : () => setActiveSpace(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>邀请成员</DialogTitle>
        <DialogContent>
          <Stack
            id="member-invite-form"
            component="form"
            noValidate
            spacing={2}
            sx={{ pt: 1 }}
            onSubmit={sendInvitation}
          >
            <Controller
              name="email"
              control={invitationForm.control}
              render={({ field, fieldState }) => (
                <TextField
                  {...field}
                  label="成员邮箱"
                  type="email"
                  disabled={sending}
                  autoFocus
                  fullWidth
                  error={Boolean(fieldState.error)}
                  helperText={fieldState.error?.message}
                />
              )}
            />
            <Typography variant="body2" color="text.secondary">
              邀请链接将在 24 小时后失效。
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            color="inherit"
            onClick={() => setActiveSpace(null)}
            disabled={sending}
          >
            关闭
          </Button>
          <Button
            type="submit"
            form="member-invite-form"
            variant="contained"
            disabled={sending || !invitationForm.formState.isValid}
          >
            {sending ? "正在发送" : "发送邀请"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(deleteTarget)}
        onClose={
          removingMemberId ? undefined : () => setDeleteTarget(null)
        }
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>删除成员账号</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary">
            确认删除“{deleteTarget?.member.name}”？该成员将从当前客户移除；若没有其他客户归属，其登录账号和现有会话也会一并清除。
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button
            onClick={() => setDeleteTarget(null)}
            disabled={Boolean(removingMemberId)}
          >
            取消
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => void removeMember()}
            disabled={Boolean(removingMemberId)}
          >
            确认删除
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
