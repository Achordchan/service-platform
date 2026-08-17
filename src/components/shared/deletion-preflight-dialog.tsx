"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  LinearProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import CancelOutlinedIcon from "@mui/icons-material/CancelOutlined";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";
import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";
import type {
  DeletionCheck,
  DeletionReport,
  DeletionResourceType,
} from "@/modules/deletion/deletion-types";
import {
  jsonRequest,
  staffApi,
  StaffApiError,
} from "@/components/staff/staff-api";

type DeleteTarget = {
  resourceType: DeletionResourceType;
  resourceId: string;
  resourceLabel: string;
};

export function DeletionPreflightDialog({
  target,
  deleteUrl,
  onClose,
  onDeleted,
}: {
  target: DeleteTarget | null;
  deleteUrl: string | null;
  onClose: () => void;
  onDeleted: () => void | Promise<void>;
}) {
  const [report, setReport] = useState<DeletionReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState("");

  const runCheck = useCallback(async () => {
    if (!target) return;
    setChecking(true);
    setError("");
    setReport(null);
    setConfirmation("");
    try {
      const nextReport = await staffApi<DeletionReport>(
        "/api/v1/admin/deletion-checks",
        jsonRequest("POST", {
          resourceType: target.resourceType,
          resourceId: target.resourceId,
        }),
      );
      setReport(nextReport);
    } catch (checkError) {
      setError(
        checkError instanceof Error ? checkError.message : "删除检测失败",
      );
    } finally {
      setChecking(false);
    }
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const timer = window.setTimeout(() => {
      void runCheck();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [runCheck, target]);

  function closeDialog() {
    setReport(null);
    setError("");
    setConfirmation("");
    onClose();
  }

  async function confirmDelete() {
    if (!target || !deleteUrl || !report?.allowed) return;
    setDeleting(true);
    setError("");
    try {
      await staffApi(deleteUrl, jsonRequest("DELETE"));
      await onDeleted();
      closeDialog();
    } catch (deleteError) {
      if (
        deleteError instanceof StaffApiError &&
        deleteError.code === "DELETION_BLOCKED" &&
        isDeletionReport(deleteError.details)
      ) {
        setReport(deleteError.details);
      }
      setError(
        deleteError instanceof Error ? deleteError.message : "删除失败",
      );
    } finally {
      setDeleting(false);
    }
  }

  const requiresTyping = report?.confirmationMode === "TYPE_NAME";
  const confirmationReady =
    report?.allowed === true &&
    (!requiresTyping || confirmation.trim() === report.resourceLabel);

  return (
    <Dialog
      open={Boolean(target)}
      onClose={checking || deleting ? undefined : closeDialog}
      fullWidth
      maxWidth="sm"
    >
      {checking || deleting ? <LinearProgress /> : null}
      <DialogTitle>删除检测</DialogTitle>
      <DialogContent>
        <Stack spacing={1.75} sx={{ pt: 0.5 }}>
          <Box>
            <Typography sx={{ fontWeight: 650 }} noWrap>
              {target?.resourceLabel}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              系统会检查关联数据和不可恢复的影响，再决定是否允许删除。
            </Typography>
          </Box>

          {checking ? (
            <Alert severity="info">正在读取最新关联数据并执行删除检测。</Alert>
          ) : null}
          {error ? <Alert severity="error">{error}</Alert> : null}

          {report ? (
            <>
              <Stack
                divider={<Divider flexItem />}
                sx={{
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 2,
                  overflow: "hidden",
                }}
              >
                {report.checks.map((check) => (
                  <CheckRow key={check.key} check={check} />
                ))}
              </Stack>

              <Alert severity={report.allowed ? "success" : "error"}>
                {report.allowed
                  ? "删除检测已通过，可以继续确认删除。"
                  : "存在阻断项，处理完成后请重新检测。"}
              </Alert>

              {requiresTyping && report.allowed ? (
                <TextField
                  label="输入项目名称确认"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  placeholder={report.resourceLabel}
                  helperText="项目及其请求、动态和附件将被永久删除。"
                  autoComplete="off"
                  fullWidth
                />
              ) : null}
            </>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions
        sx={{
          px: 3,
          pb: 3,
          flexWrap: "wrap",
          rowGap: 1,
        }}
      >
        <Button
          onClick={() => void runCheck()}
          disabled={checking || deleting || !target}
        >
          重新检测
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={closeDialog} disabled={checking || deleting}>
          取消
        </Button>
        <Button
          color="error"
          variant="contained"
          disabled={!confirmationReady || checking || deleting}
          onClick={() => void confirmDelete()}
        >
          {deleting ? "正在删除" : "确认删除"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function CheckRow({ check }: { check: DeletionCheck }) {
  const config = {
    PASS: {
      color: "success.main",
      icon: <CheckCircleOutlinedIcon fontSize="small" />,
      label: "通过",
    },
    WARN: {
      color: "warning.main",
      icon: <WarningAmberOutlinedIcon fontSize="small" />,
      label: "影响",
    },
    BLOCK: {
      color: "error.main",
      icon: <CancelOutlinedIcon fontSize="small" />,
      label: "阻断",
    },
  }[check.status];

  return (
    <Stack
      direction="row"
      spacing={1.25}
      sx={{
        px: 1.75,
        py: check.status === "PASS" ? 0.75 : 1.5,
        alignItems: "flex-start",
        bgcolor:
          check.status === "BLOCK"
            ? "rgba(211,67,67,0.035)"
            : check.status === "WARN"
              ? "rgba(217,139,22,0.035)"
              : "background.paper",
      }}
    >
      <Box
        aria-label={config.label}
        sx={{
          color: config.color,
          display: "grid",
          placeItems: "center",
          mt: 0.15,
        }}
      >
        {config.icon}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ alignItems: "baseline", flexWrap: "wrap" }}
        >
          <Typography variant="body2" sx={{ fontWeight: 650 }}>
            {check.label}
          </Typography>
          {check.count !== undefined ? (
            <Typography variant="caption" color="text.secondary">
              {check.count} 项
            </Typography>
          ) : null}
        </Stack>
        {check.status !== "PASS" ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>
            {check.message}
          </Typography>
        ) : null}
        {check.actionHref && check.actionLabel ? (
          <Button
            component={Link}
            href={check.actionHref}
            size="small"
            sx={{ mt: 0.5, px: 0 }}
          >
            {check.actionLabel}
          </Button>
        ) : null}
      </Box>
    </Stack>
  );
}

function isDeletionReport(value: unknown): value is DeletionReport {
  return (
    typeof value === "object" &&
    value !== null &&
    "allowed" in value &&
    "checks" in value &&
    Array.isArray((value as { checks?: unknown }).checks)
  );
}
