"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Paper, Stack, Typography } from "@mui/material";
import ArchiveOutlinedIcon from "@mui/icons-material/ArchiveOutlined";
import UnarchiveOutlinedIcon from "@mui/icons-material/UnarchiveOutlined";
import { useToast } from "@/components/shared/toast-provider";
import { markRequestLocalMutation } from "@/hooks/use-request-realtime";
import { canArchiveRequestStatus } from "@/lib/request-archive";
import type { DeliveryFeedback } from "@/lib/operation-feedback";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function RequestArchivePanel({
  requestId,
  status,
  archivedAt,
}: {
  requestId: string;
  status: string;
  archivedAt?: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  const archived = Boolean(archivedAt);
  const canArchive = canArchiveRequestStatus(status);
  if (!archived && !canArchive) return null;

  async function updateArchive() {
    setSubmitting(true);
    try {
      const response = await fetch(`/api/v1/requests/${requestId}/archive`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: !archived }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        data?: { deliveryFeedback?: DeliveryFeedback | null };
        error?: { message?: string } | string;
      };
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : payload.error?.message || "归档操作失败",
        );
      }
      toast.success(
        archived ? "服务请求已恢复到常规列表" : "服务请求已归档",
      );
      toast.delivery(payload.data?.deliveryFeedback);
      markRequestLocalMutation();
      router.refresh();
    } catch (updateError) {
      toast.error(
        updateError instanceof Error ? updateError.message : "归档操作失败",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Typography variant="h3">归档管理</Typography>
      <Stack spacing={1.5} sx={{ mt: 1.5 }}>
        <Typography variant="body2" color="text.secondary">
          {archived && archivedAt
            ? `已归档于 ${dateFormatter.format(new Date(archivedAt))}`
            : "归档后将从常规列表隐藏，可在“已归档”中查看。"}
        </Typography>
        <Button
          variant={archived ? "outlined" : "contained"}
          startIcon={
            archived ? <UnarchiveOutlinedIcon /> : <ArchiveOutlinedIcon />
          }
          onClick={() => void updateArchive()}
          disabled={submitting}
        >
          {submitting ? "处理中" : archived ? "恢复到常规列表" : "归档请求"}
        </Button>
      </Stack>
    </Paper>
  );
}
