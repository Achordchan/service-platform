"use client";

import { useMemo, useState } from "react";
import {
  markRequestLocalMutation,
  useRequestRealtime,
} from "@/hooks/use-request-realtime";
import { useRequestNotificationsRead } from "@/hooks/use-request-notifications-read";
import { useRequestPresence } from "@/hooks/use-request-presence";
import { useRouter } from "next/navigation";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { RequestChatHeading } from "@/components/shared/request-chat-heading";
import { RequestChatThread } from "@/components/shared/request-chat-thread";
import type { ChatReplyTarget } from "@/components/shared/request-chat-types";
import { RequestReplyComposer } from "@/components/staff/request-reply-composer";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";
import {
  PriorityChip,
  StaffStatus,
  statusLabel,
} from "@/components/staff/staff-status";
import type {
  ProjectStaffMember,
  RequestDetail,
  RequestStatus,
} from "@/components/staff/staff-types";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const nextStatuses: Record<RequestStatus, RequestStatus[]> = {
  PENDING: ["IN_PROGRESS"],
  IN_PROGRESS: ["RESOLVED"],
  WAITING_CUSTOMER: ["IN_PROGRESS", "RESOLVED"],
  RESOLVED: ["IN_PROGRESS"],
  CLOSED: [],
};

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Box sx={{ mt: 0.65 }}>{value}</Box>
    </Box>
  );
}

export function RequestDetailWorkspace({
  request,
  projectStaff,
  canManage,
  canAssign,
  currentUserId,
  claimRequired,
}: {
  request: RequestDetail;
  projectStaff: ProjectStaffMember[];
  canManage: boolean;
  canAssign: boolean;
  currentUserId: string;
  claimRequired: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [replyTarget, setReplyTarget] = useState<ChatReplyTarget | null>(null);
  const presence = useRequestPresence(request.id, "STAFF");
  useRequestRealtime(request.id, { currentUserId });
  useRequestNotificationsRead(request.id);

  const selectedAssignees = useMemo(() => {
    const selectedIds = new Set(
      (request.assignees?.length
        ? request.assignees.map((item) => item.id)
        : request.assigneeId
          ? [request.assigneeId]
          : []) as string[],
    );
    return projectStaff.filter((member) => selectedIds.has(member.userId));
  }, [projectStaff, request.assigneeId, request.assignees]);

  async function updateAssignees(members: ProjectStaffMember[]) {
    setSubmitting(true);
    setError("");
    try {
      await staffApi(
        `/api/v1/requests/${request.id}/assignee`,
        jsonRequest("PATCH", {
          assigneeIds: members.map((member) => member.userId),
        }),
      );
      markRequestLocalMutation();
      router.refresh();
    } catch (updateError) {
      setError(
        updateError instanceof Error ? updateError.message : "分配失败",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function updateStatus(status: RequestStatus) {
    setSubmitting(true);
    setError("");
    try {
      await staffApi(
        `/api/v1/requests/${request.id}/status`,
        jsonRequest("PATCH", { status }),
      );
      markRequestLocalMutation();
      router.refresh();
    } catch (updateError) {
      setError(
        updateError instanceof Error ? updateError.message : "状态更新失败",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const availableStatuses = nextStatuses[request.status];
  const assigneeNames =
    request.assignees && request.assignees.length > 0
      ? request.assignees.map((item) => item.name).join("、")
      : request.assigneeName || "待分配";

  return (
    <Stack spacing={3}>
      {submitting ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1fr) 320px" },
          gap: 3,
          alignItems: "start",
        }}
      >
        <Stack spacing={2.5}>
          <Box>
            <RequestChatHeading
              counterpartOnline={presence.counterpartOnline}
              counterpartLabel="客户"
            />
            <RequestChatThread
              messages={request.messages}
              currentUserId={currentUserId}
              onReply={setReplyTarget}
              counterpartTypingLabel={
                presence.counterpartTyping ? "客户" : null
              }
            />
          </Box>

          {canManage && request.status !== "CLOSED" ? (
            <RequestReplyComposer
              requestId={request.id}
              replyTarget={replyTarget}
              onCancelReply={() => setReplyTarget(null)}
              claimRequired={claimRequired}
              onTypingActivity={presence.reportTypingActivity}
              onTypingStopped={presence.stopTyping}
            />
          ) : request.status === "CLOSED" ? (
            <Alert severity="info">该服务请求已关闭，不能继续回复。</Alert>
          ) : (
            <Alert severity="info">当前请求未分配给你，仅可查看。</Alert>
          )}
        </Stack>

        <Stack spacing={2} sx={{ position: { lg: "sticky" }, top: { lg: 96 } }}>
          {canManage && availableStatuses.length > 0 ? (
            <Paper variant="outlined" sx={{ p: 2.5 }}>
              <Typography variant="h3">更新状态</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                当前：{statusLabel(request.status)}
              </Typography>
              <Stack spacing={1} sx={{ mt: 2 }}>
                {availableStatuses.map((status) => (
                  <Button
                    key={status}
                    variant={status === "RESOLVED" ? "contained" : "outlined"}
                    onClick={() => updateStatus(status)}
                    disabled={submitting}
                  >
                    改为{statusLabel(status)}
                  </Button>
                ))}
              </Stack>
            </Paper>
          ) : null}

          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Typography variant="h3">请求信息</Typography>
            <Stack spacing={2.25} sx={{ mt: 2.5 }}>
              <DetailField label="状态" value={<StaffStatus value={request.status} />} />
              <DetailField label="优先级" value={<PriorityChip value={request.priority} />} />
              <DetailField label="客户" value={request.customerName} />
              <DetailField label="提交人" value={request.createdByName} />
              {request.externalContact ? (
                <>
                  <DetailField label="来源" value={<Chip size="small" label="Sub2API" variant="outlined" />} />
                  <DetailField label="外部用户 ID" value={request.externalContact.externalUserId} />
                  <DetailField label="外部邮箱" value={request.externalContact.email || "未提供"} />
                  <DetailField label="外部用户名" value={request.externalContact.username || "未提供"} />
                  <DetailField label="联系人状态" value={request.externalContact.status === "ACTIVE" ? "正常" : "已停用"} />
                </>
              ) : null}
              <DetailField label="所属项目" value={request.projectTitle} />
              <DetailField label="请求分类" value={request.categoryName} />
              <DetailField label="处理人" value={assigneeNames} />
              <DetailField
                label="提交时间"
                value={dateFormatter.format(new Date(request.createdAt))}
              />
              <DetailField
                label="最后更新"
                value={dateFormatter.format(new Date(request.updatedAt))}
              />
            </Stack>
          </Paper>

          {canAssign ? (
            <Paper variant="outlined" sx={{ p: 2.5 }}>
              <Typography variant="h3">分配处理人</Typography>
              <Autocomplete
                multiple
                options={projectStaff}
                value={selectedAssignees}
                disableCloseOnSelect
                getOptionLabel={(option) =>
                  `${option.name} · ${
                    option.role === "PROJECT_MANAGER" ? "项目负责人" : "技术人员"
                  }`
                }
                isOptionEqualToValue={(option, value) =>
                  option.userId === value.userId
                }
                onChange={(_event, value) => updateAssignees(value)}
                disabled={submitting || request.status === "CLOSED"}
                sx={{ mt: 2 }}
                renderInput={(params) => (
                  <TextField {...params} label="处理人" placeholder="选择处理人" />
                )}
              />
            </Paper>
          ) : null}
        </Stack>
      </Box>
    </Stack>
  );
}
