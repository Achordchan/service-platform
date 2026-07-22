"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Paper, Stack, Typography } from "@mui/material";
import ArchiveOutlinedIcon from "@mui/icons-material/ArchiveOutlined";
import UnarchiveOutlinedIcon from "@mui/icons-material/UnarchiveOutlined";
import { markRequestLocalMutation } from "@/hooks/use-request-realtime";
import { canArchiveRequestStatus } from "@/lib/request-archive";

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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const archived = Boolean(archivedAt);
  const canArchive = canArchiveRequestStatus(status);
  if (!archived && !canArchive) return null;

  async function updateArchive() {
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/requests/${requestId}/archive`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: !archived }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: { message?: string } | string;
      };
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : payload.error?.message || "归档操作失败",
        );
      }
      markRequestLocalMutation();
      router.refresh();
    } catch (updateError) {
      setError(
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
        {error ? <Alert severity="error">{error}</Alert> : null}
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
