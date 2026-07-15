"use client";

import Link from "next/link";
import { useRequestRealtime } from "@/hooks/use-request-realtime";
import { useRequestNotificationsRead } from "@/hooks/use-request-notifications-read";
import {
  Alert,
  Box,
  Chip,
  IconButton,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import { CollapsibleText } from "@/components/shared/collapsible-text";
import { RequestChatThread } from "@/components/shared/request-chat-thread";
import type {
  RequestAttachment,
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

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function AttachmentList({ files }: { files: RequestAttachment[] }) {
  if (files.length === 0) return null;
  return (
    <Stack spacing={1} sx={{ mt: 2 }}>
      {files.map((file) => (
        <Stack
          key={file.id}
          direction="row"
          spacing={1.5}
          sx={{
            p: 1.25,
            borderRadius: 1.5,
            bgcolor: "#f8fafc",
            alignItems: "center",
          }}
        >
          <InsertDriveFileOutlinedIcon
            sx={{ fontSize: 20, color: "text.secondary" }}
          />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
              {file.originalName}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {formatSize(file.size)}
            </Typography>
          </Box>
          <IconButton
            component={Link}
            href={`/api/v1/attachments/${file.id}`}
            aria-label={`下载 ${file.originalName}`}
            size="small"
          >
            <DownloadOutlinedIcon fontSize="small" />
          </IconButton>
        </Stack>
      ))}
    </Stack>
  );
}

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
  useRequestRealtime(request.id, { currentUserId });
  useRequestNotificationsRead(request.id);
  return (
    <Stack spacing={3}>
      <PageHeading
        backLabel="返回项目请求"
        backHref={`/customer/projects/${request.projectId}?tab=requests`}
        title={request.title}
        description={`${request.number} · ${request.projectTitle}`}
        status={<StatusIndicator status={request.status} />}
      />
      {created ? (
        <Alert severity="success">服务请求已提交。</Alert>
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
            <Typography variant="h3" sx={{ mb: 1.5 }}>
              沟通记录
            </Typography>
            <RequestChatThread
              messages={request.messages}
              currentUserId={currentUserId}
            />
          </Box>

          <RequestReplyForm
            requestId={request.id}
            disabled={request.status === "CLOSED"}
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
              <Box>
                <Typography variant="body2" color="text.secondary">
                  请求描述
                </Typography>
                <CollapsibleText text={request.description} maxLines={5} />
                <AttachmentList files={request.attachments} />
              </Box>
            </Stack>
          </Paper>
        </Stack>
      </Box>
    </Stack>
  );
}
