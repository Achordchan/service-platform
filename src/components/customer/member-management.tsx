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

export function MemberManagement({ spaces }: { spaces: SpaceMembers[] }) {
  const router = useRouter();
  const [activeSpace, setActiveSpace] = useState<SpaceMembers | null>(null);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<
    "idle" | "sending" | "success" | "error"
  >("idle");
  const [invitationError, setInvitationError] = useState("");
  const [memberError, setMemberError] = useState("");
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);

  async function sendInvitation() {
    if (!activeSpace) return;
    setState("sending");
    setInvitationError("");
    try {
      await staffApi(
        `/api/v1/admin/customer-spaces/${activeSpace.id}/invitations`,
        jsonRequest("POST", { email }),
      );
      setState("success");
    } catch (error) {
      setInvitationError(
        error instanceof Error ? error.message : "邀请发送失败",
      );
      setState("error");
    }
  }

  async function removeMember(spaceId: string, membershipId: string) {
    setMemberError("");
    setRemovingMemberId(membershipId);
    try {
      await staffApi(
        `/api/v1/admin/customer-spaces/${spaceId}/members/${membershipId}`,
        { method: "DELETE" },
      );
      router.refresh();
    } catch (error) {
      setMemberError(
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
      {memberError ? (
        <Alert severity="error" onClose={() => setMemberError("")}>
          {memberError}
        </Alert>
      ) : null}
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
                  setState("idle");
                  setInvitationError("");
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
                        onClick={() => removeMember(space.id, member.id)}
                      >
                        {removingMemberId === member.id ? "移除中" : "移除"}
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
            {state === "success" ? (
              <Alert severity="success">邀请邮件已加入发送队列。</Alert>
            ) : null}
            {state === "error" ? (
              <Alert severity="error">
                {invitationError || "邀请发送失败"}
              </Alert>
            ) : null}
            <TextField
              label="成员邮箱"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={state === "sending" || state === "success"}
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
              !email.trim() || state === "sending" || state === "success"
            }
          >
            {state === "sending" ? "正在发送" : "发送邀请"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
