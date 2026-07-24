"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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

export function MemberManagement({ spaces }: { spaces: SpaceMembers[] }) {
  const router = useRouter();
  const toast = useToast();
  const [activeSpace, setActiveSpace] = useState<SpaceMembers | null>(null);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  async function sendInvitation() {
    if (!activeSpace) return;
    setSending(true);
    try {
      await staffApi(
        `/api/v1/admin/customer-spaces/${activeSpace.id}/invitations`,
        jsonRequest("POST", { email }),
      );
      toast.success("邀请邮件已加入发送队列");
      setActiveSpace(null);
      setEmail("");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "邀请发送失败",
      );
    } finally {
      setSending(false);
    }
  }

  async function removeMember() {
    if (!deleteTarget) return;
    setRemovingMemberId(deleteTarget.member.id);
    try {
      const result = await staffApi<{ accountDeleted: boolean }>(
        `/api/v1/admin/customer-spaces/${deleteTarget.spaceId}/members/${deleteTarget.member.id}`,
        { method: "DELETE" },
      );
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
    } finally {
      setRemovingMemberId(null);
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
                  setEmail("");
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
        onClose={() => setActiveSpace(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>邀请成员</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="成员邮箱"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={sending}
              autoFocus
              fullWidth
            />
            <Typography variant="body2" color="text.secondary">
              邀请链接将在 24 小时后失效。
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setActiveSpace(null)}>
            关闭
          </Button>
          <Button
            variant="contained"
            onClick={sendInvitation}
            disabled={
              !email.trim() || sending
            }
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
