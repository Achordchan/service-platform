"use client";

import { useEffect, useState } from "react";
import { useRequestRealtime } from "@/hooks/use-request-realtime";
import { useRequestNotificationsRead } from "@/hooks/use-request-notifications-read";
import { useRequestPresence } from "@/hooks/use-request-presence";
import {
  Alert,
  Box,
  Chip,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { RequestChatHeading } from "@/components/shared/request-chat-heading";
import { RequestChatThread } from "@/components/shared/request-chat-thread";
import type { ChatReplyTarget } from "@/components/shared/request-chat-types";
import type {
  RequestPriority,
  ServiceRequestDetail,
} from "@/components/customer/customer-types";
import { PageHeading } from "@/components/customer/page-heading";
import { RequestReplyForm } from "@/components/customer/request-reply-form";
import { StatusIndicator } from "@/components/shared/status-indicator";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const priorityMap: Record<
  RequestPriority,
  { label: string; color: "default" | "primary" | "warning" | "error" }
> = {
  LOW: { label: "低", color: "default" },
  NORMAL: { label: "普通", color: "primary" },
  HIGH: { label: "高", color: "warning" },
  URGENT: { label: "紧急", color: "error" },
};

export function RequestDetail({
  request,
  currentUserId,
  created,
}: {
  request: ServiceRequestDetail;
  currentUserId: string;
  created?: boolean;
}) {
  const priority = priorityMap[request.priority];
  const [showCreatedNotice, setShowCreatedNotice] = useState(created === true);
  const [replyTarget, setReplyTarget] = useState<ChatReplyTarget | null>(null);
  const presence = useRequestPresence(request.id, "CUSTOMER");
  useRequestRealtime(request.id, { currentUserId });
  useRequestNotificationsRead(request.id);

  useEffect(() => {
    if (!created) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("created");
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    const timer = window.setTimeout(() => setShowCreatedNotice(false), 5_000);
    return () => window.clearTimeout(timer);
  }, [created]);

  return (
    <Stack spacing={3}>
      <PageHeading
        backLabel="返回项目请求"
        backHref={`/customer/projects/${request.projectId}?tab=requests`}
        title={request.title}
        description={`${request.number} · ${request.projectTitle}`}
        status={<StatusIndicator status={request.status} />}
      />
      {showCreatedNotice ? (
        <Alert severity="success" onClose={() => setShowCreatedNotice(false)}>
          服务请求已提交。
        </Alert>
      ) : null}

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
              counterpartLabel="服务人员"
            />
            <RequestChatThread
              messages={request.messages}
              currentUserId={currentUserId}
              onReply={setReplyTarget}
              counterpartTypingLabel={
                presence.counterpartTyping ? "服务人员" : null
              }
            />
          </Box>

          <RequestReplyForm
            requestId={request.id}
            disabled={request.status === "CLOSED"}
            replyTarget={replyTarget}
            onCancelReply={() => setReplyTarget(null)}
            onTypingActivity={() =>
              presence.reportTypingActivity("CUSTOMER_VISIBLE")
            }
            onTypingStopped={presence.stopTyping}
          />
        </Stack>

        <Stack spacing={2} sx={{ position: { lg: "sticky" }, top: { lg: 100 } }}>
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Typography variant="h3">请求信息</Typography>
            <Stack spacing={2.25} sx={{ mt: 2.5 }}>
              <Box>
                <Typography variant="body2" color="text.secondary">
                  状态
                </Typography>
                <Box sx={{ mt: 0.65 }}>
                  <StatusIndicator status={request.status} />
                </Box>
              </Box>
              <Box>
                <Typography variant="body2" color="text.secondary">
                  优先级
                </Typography>
                <Box sx={{ mt: 0.65 }}>
                  <Chip
                    label={priority.label}
                    color={priority.color}
                    size="small"
                    variant="outlined"
                  />
                </Box>
              </Box>
              <Box>
                <Typography variant="body2" color="text.secondary">
                  所属项目
                </Typography>
                <Typography sx={{ mt: 0.65 }}>{request.projectTitle}</Typography>
              </Box>
              <Box>
                <Typography variant="body2" color="text.secondary">
                  请求分类
                </Typography>
                <Typography sx={{ mt: 0.65 }}>{request.category.name}</Typography>
              </Box>
              <Box>
                <Typography variant="body2" color="text.secondary">
                  处理人
                </Typography>
                <Typography sx={{ mt: 0.65 }}>
                  {(request.assigneeNames && request.assigneeNames.length > 0
                    ? request.assigneeNames.join("、")
                    : request.assigneeName) || "待分配"}
                </Typography>
              </Box>
              <Box>
                <Typography variant="body2" color="text.secondary">
                  提交人
                </Typography>
                <Typography sx={{ mt: 0.65 }}>{request.createdByName}</Typography>
              </Box>
              <Box>
                <Typography variant="body2" color="text.secondary">
                  提交时间
                </Typography>
                <Typography sx={{ mt: 0.65 }}>
                  {dateFormatter.format(new Date(request.createdAt))}
                </Typography>
              </Box>
              <Box>
                <Typography variant="body2" color="text.secondary">
                  最后更新
                </Typography>
                <Typography sx={{ mt: 0.65 }}>
                  {dateFormatter.format(new Date(request.updatedAt))}
                </Typography>
              </Box>
            </Stack>
          </Paper>
        </Stack>
      </Box>
    </Stack>
  );
}
