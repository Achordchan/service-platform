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
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { RequestChatThread } from "@/components/shared/request-chat-thread";
import { RequestArchivePanel } from "@/components/shared/request-archive-panel";
import { RequestPresenceIndicator } from "@/components/shared/request-presence-indicator";
import type {
  ChatMessage,
  ChatReeditDraft,
  ChatReplyTarget,
} from "@/components/shared/request-chat-types";
import { CustomerClientContextDialog } from "@/components/staff/customer-client-context-dialog";
import { DeliveryNotice } from "@/components/shared/delivery-notice";
import { useToast } from "@/components/shared/toast-provider";
import { deliveryOverridePayload } from "@/lib/delivery-notice";
import { useDeliveryChannelRule } from "@/hooks/use-delivery-channels";
import type { NotificationDeliveryOverride } from "@/modules/notifications/notification-delivery-override";
import { RequestReplyComposer } from "@/components/staff/request-reply-composer";
import { StaffPageHeading } from "@/components/staff/staff-page-heading";
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
import type { DeliveryFeedback } from "@/lib/operation-feedback";
import { SlaIndicator } from "@/components/staff/sla-indicator";

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
  canReply,
  canChangeStatus,
  canArchive,
  canAssign,
  currentUserId,
  claimRequired,
  contentRiskNoticeEnabled,
  headingDescription,
  canViewRevokedContent,
  canModerateMessages,
}: {
  request: RequestDetail;
  projectStaff: ProjectStaffMember[];
  canReply: boolean;
  canChangeStatus: boolean;
  canArchive: boolean;
  canAssign: boolean;
  currentUserId: string;
  claimRequired: boolean;
  contentRiskNoticeEnabled: boolean;
  headingDescription: string;
  canViewRevokedContent: boolean;
  canModerateMessages: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [clientContextOpen, setClientContextOpen] = useState(false);
  // 状态变更原本是一排「点了立刻生效」的按钮，没有提交步骤挂不住发送前提示；
  // 改成先选目标状态、看清会提醒谁，再确认。
  const [pendingStatus, setPendingStatus] = useState<RequestStatus | null>(null);
  const [statusOverride, setStatusOverride] =
    useState<NotificationDeliveryOverride>({});
  const statusDeliveryRule = useDeliveryChannelRule("REQUEST_STATUS");
  const [replyTarget, setReplyTarget] = useState<ChatReplyTarget | null>(null);
  const [reeditDraft, setReeditDraft] = useState<ChatReeditDraft | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ChatMessage | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [revoking, setRevoking] = useState(false);
  const presence = useRequestPresence(request.id, "STAFF");
  useRequestRealtime(request.id, {
    currentUserId,
    projectId: request.projectId,
  });
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
    try {
      const result = await staffApi<{ deliveryFeedback: DeliveryFeedback }>(
        `/api/v1/requests/${request.id}/assignee`,
        jsonRequest("PATCH", {
          assigneeIds: members.map((member) => member.userId),
        }),
      );
      toast.success(
        members.length > 0 ? "处理人已更新" : "服务请求已取消分配",
      );
      toast.delivery(result.deliveryFeedback);
      markRequestLocalMutation();
      router.refresh();
    } catch (updateError) {
      toast.error(
        updateError instanceof Error ? updateError.message : "分配失败",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function updateStatus(status: RequestStatus) {
    setSubmitting(true);
    try {
      const result = await staffApi<{ deliveryFeedback: DeliveryFeedback }>(
        `/api/v1/requests/${request.id}/status`,
        jsonRequest("PATCH", {
          status,
          ...deliveryOverridePayload(statusOverride, statusDeliveryRule),
        }),
      );
      toast.success(`服务请求状态已更新为${statusLabel(status)}`);
      toast.delivery(result.deliveryFeedback);
      // 覆盖是一次性的，不跨下一次操作沿用
      setPendingStatus(null);
      setStatusOverride({});
      markRequestLocalMutation();
      router.refresh();
    } catch (updateError) {
      toast.error(
        updateError instanceof Error ? updateError.message : "状态更新失败",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function revokeMessage() {
    if (!revokeTarget || revokeReason.trim().length < 2) return;
    setRevoking(true);
    try {
      await staffApi(
        `/api/v1/requests/${request.id}/messages/${revokeTarget.id}/revoke`,
        jsonRequest("POST", { reason: revokeReason.trim() }),
      );
      toast.success("消息已由系统撤回");
      setRevokeTarget(null);
      setRevokeReason("");
      markRequestLocalMutation();
      router.refresh();
    } catch (revokeError) {
      toast.error(
        revokeError instanceof Error ? revokeError.message : "撤回消息失败",
      );
    } finally {
      setRevoking(false);
    }
  }

  function closeRevokeDialog() {
    if (revoking) return;
    setRevokeTarget(null);
    setRevokeReason("");
  }

  const availableStatuses = nextStatuses[request.status];
  const assigneeNames =
    request.assignees && request.assignees.length > 0
      ? request.assignees.map((item) => item.name).join("、")
      : request.assigneeName || "待分配";

  return (
    <Stack spacing={3}>
      <StaffPageHeading
        backHref="/staff/requests"
        backLabel="服务请求"
        title={request.title}
        description={headingDescription}
        status={
          <>
            <StaffStatus value={request.status} />
            <RequestPresenceIndicator
              online={presence.counterpartOnline}
              clients={presence.counterpartClients}
              label="客户在线"
            />
          </>
        }
      />
      {submitting ? <LinearProgress /> : null}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1fr) 320px" },
          gap: 3,
          alignItems: "start",
        }}
      >
        <Stack spacing={2.5}>
          <RequestChatThread
            messages={request.messages}
            currentUserId={currentUserId}
            contentRiskEnabled={request.contentRiskUiEnabled}
            canViewRevokedContent={canViewRevokedContent}
            onReply={setReplyTarget}
            onPinAttachmentToProject={async (file) => {
              try {
                await staffApi(
                  `/api/v1/attachments/${file.id}/pin`,
                  jsonRequest("POST", { pinned: true }),
                );
                toast.success("已添加到项目文件");
              } catch (pinError) {
                toast.error(
                  pinError instanceof Error ? pinError.message : "添加失败",
                );
              }
            }}
            onReedit={
              canReply && !request.archivedAt && request.status !== "CLOSED"
                ? (message) => {
                    if (!message.reeditBody) return;
                    setReplyTarget(null);
                    setReeditDraft((current) => ({
                      version: (current?.version ?? 0) + 1,
                      requestId: request.id,
                      messageId: message.id,
                      body: message.reeditBody!,
                      attachmentCount: message.reeditAttachmentCount ?? 0,
                    }));
                    requestAnimationFrame(() => {
                      document
                        .getElementById("request-reply-composer")
                        ?.scrollIntoView({
                          behavior: "smooth",
                          block: "center",
                        });
                    });
                  }
                : undefined
            }
            onRevoke={
              canModerateMessages
                ? (message) => {
                    setRevokeReason("");
                    setRevokeTarget(message);
                  }
                : undefined
            }
            counterpartTypingLabel={
              presence.counterpartTyping ? "客户" : null
            }
          />

          {request.archivedAt ? (
            <Alert severity="info">
              该服务请求已归档。恢复到常规列表后才能继续处理或回复。
            </Alert>
          ) : canReply && request.status !== "CLOSED" ? (
            <RequestReplyComposer
              key={`${request.id}:${reeditDraft?.version ?? 0}`}
              requestId={request.id}
              replyTarget={replyTarget}
              onCancelReply={() => setReplyTarget(null)}
              claimRequired={claimRequired}
              onTypingActivity={presence.reportTypingActivity}
              onTypingStopped={presence.stopTyping}
              contentRiskEnabled={contentRiskNoticeEnabled}
              initialBody={reeditDraft?.body}
              restoredAttachmentCount={reeditDraft?.attachmentCount ?? 0}
              onSent={() => setReeditDraft(null)}
            />
          ) : request.status === "CLOSED" ? (
            <Alert severity="info">该服务请求已关闭，不能继续回复。</Alert>
          ) : (
            <Alert severity="info">当前请求未分配给你，仅可查看。</Alert>
          )}
        </Stack>

        <Stack spacing={2} sx={{ position: { lg: "sticky" }, top: { lg: 88 }, maxHeight: { lg: "calc(100vh - 104px)" }, overflowY: { lg: "auto" } }}>
          {canChangeStatus &&
          !request.archivedAt &&
          availableStatuses.length > 0 ? (
            <Paper variant="outlined" sx={{ p: 2.5 }}>
              <Typography variant="h3">更新状态</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                当前：{statusLabel(request.status)}
              </Typography>
              <Stack spacing={1} sx={{ mt: 2 }}>
                {availableStatuses.map((status) => (
                  <Button
                    key={status}
                    variant={
                      pendingStatus === status
                        ? "contained"
                        : status === "RESOLVED" && !pendingStatus
                          ? "contained"
                          : "outlined"
                    }
                    onClick={() => {
                      setPendingStatus(status);
                      setStatusOverride({});
                    }}
                    disabled={submitting}
                  >
                    改为{statusLabel(status)}
                  </Button>
                ))}
              </Stack>
              {pendingStatus ? (
                <Stack spacing={1.5} sx={{ mt: 2 }}>
                  <DeliveryNotice
                    scene={{
                      scene: "REQUEST_STATUS",
                      requestId: request.id,
                      status: pendingStatus,
                    }}
                    override={statusOverride}
                    onOverrideChange={setStatusOverride}
                    disabled={submitting}
                  />
                  <Stack direction="row" spacing={1}>
                    <Button
                      variant="contained"
                      onClick={() => void updateStatus(pendingStatus)}
                      disabled={submitting}
                    >
                      确认改为{statusLabel(pendingStatus)}
                    </Button>
                    <Button
                      onClick={() => {
                        setPendingStatus(null);
                        setStatusOverride({});
                      }}
                      disabled={submitting}
                    >
                      取消
                    </Button>
                  </Stack>
                </Stack>
              ) : null}
            </Paper>
          ) : null}

          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: "center", justifyContent: "space-between" }}
            >
              <Typography variant="h3">请求信息</Typography>
              {/* 客户的设备/时区/IP 归属地：常驻的在线标识旁不适合塞，做成入口 */}
              <Button size="small" onClick={() => setClientContextOpen(true)}>
                客户设备与网络
              </Button>
            </Stack>
            <Stack spacing={2.25} sx={{ mt: 2.5 }}>
              <DetailField label="状态" value={<StaffStatus value={request.status} />} />
              <DetailField label="优先级" value={<PriorityChip value={request.priority} />} />
              {(request.dueAt || request.firstRespondedAt) && (
                <DetailField
                  label="SLA"
                  value={
                    <SlaIndicator
                      dueAt={request.dueAt}
                      firstRespondedAt={request.firstRespondedAt}
                      status={request.status}
                    />
                  }
                />
              )}
              {request.firstRespondedAt && (
                <DetailField
                  label="首响时间"
                  value={dateFormatter.format(new Date(request.firstRespondedAt))}
                />
              )}
              {request.dueAt && (
                <DetailField
                  label="截止时间"
                  value={dateFormatter.format(new Date(request.dueAt))}
                />
              )}
              <DetailField label="客户" value={request.customerName} />
              <DetailField label="提交人" value={request.createdByName} />
              {request.externalContact ? (
                <>
                  <DetailField
                    label="来源"
                    value={
                      <Chip
                        size="small"
                        label={request.externalContact.sourceLabel}
                        variant="outlined"
                      />
                    }
                  />
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

          {canArchive ? (
            <RequestArchivePanel
              requestId={request.id}
              status={request.status}
              archivedAt={request.archivedAt}
            />
          ) : null}

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
                disabled={
                  submitting ||
                  request.status === "CLOSED" ||
                  Boolean(request.archivedAt)
                }
                sx={{ mt: 2 }}
                renderInput={(params) => (
                  <TextField {...params} label="处理人" placeholder="选择处理人" />
                )}
              />
            </Paper>
          ) : null}
        </Stack>
      </Box>
      <Dialog
        open={Boolean(revokeTarget)}
        onClose={revoking ? undefined : closeRevokeDialog}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>撤回消息</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <Alert severity="warning">
              撤回后，客户和普通后台人员将无法查看原文；平台管理员仍可在当前气泡和风控历史中审计。
            </Alert>
            {revokeTarget ? (
              <Typography variant="body2" color="text.secondary">
                消息发送人：{revokeTarget.authorName}
              </Typography>
            ) : null}
            <TextField
              label="撤回原因"
              value={revokeReason}
              onChange={(event) => setRevokeReason(event.target.value)}
              required
              multiline
              minRows={3}
              autoFocus
              helperText={`${revokeReason.length}/200，原因会显示在撤回提示中`}
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={closeRevokeDialog}
            disabled={revoking}
          >
            取消
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => void revokeMessage()}
            disabled={revoking || revokeReason.trim().length < 2}
          >
            {revoking ? "撤回中" : "确认撤回"}
          </Button>
        </DialogActions>
      </Dialog>

      <CustomerClientContextDialog
        requestId={request.id}
        open={clientContextOpen}
        onClose={() => setClientContextOpen(false)}
      />
    </Stack>
  );
}
