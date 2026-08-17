"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  Paper,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import GppMaybeOutlinedIcon from "@mui/icons-material/GppMaybeOutlined";
import RestoreOutlinedIcon from "@mui/icons-material/RestoreOutlined";
import { EmptyState } from "@/components/shared/content-state";
import { gridNoRowsOverlay } from "@/components/shared/data-grid-empty-overlay";
import { useToast } from "@/components/shared/toast-provider";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";
import { gridSx } from "@/lib/data-grid-styles";
import { htmlToPlainText } from "@/lib/message-content";
import { queryKeys } from "@/lib/query-keys";

type ContentRiskReviewRecord = {
  id: string;
  targetType: string;
  status: string;
  decision: string | null;
  riskCategories: unknown;
  serviceRequestId: string | null;
  projectId: string | null;
  actorId: string | null;
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
  completedAt: string | null;
  restoredAt: string | null;
  restoreReason: string | null;
  actorName: string | null;
  decisionReason: string | null;
  durationMs: number | null;
  contentSnapshot: {
    title?: string | null;
    body?: string | null;
    attachmentIds?: string[];
  } | null;
};

type PluginState = {
  enabled: boolean;
  healthStatus: string;
  config: Record<string, unknown>;
};

type Dashboard = {
  runtime: {
    enabledAt: string;
    bypassedAt: string | null;
    capabilityReport: unknown;
  } | null;
  counts: Record<string, number>;
  stats: {
    averageDurationMs: number | null;
    sampledCompletedCount: number;
  };
  reviews: ContentRiskReviewRecord[];
};

const targetLabels: Record<string, string> = {
  SERVICE_REQUEST: "新建服务请求",
  REQUEST_MESSAGE: "服务请求回复",
  PROJECT_UPDATE: "项目进度",
  UPDATE_COMMENT: "进度评论",
  MILESTONE: "项目里程碑",
  ATTACHMENT: "公开附件",
};

const statusLabels: Record<string, string> = {
  QUEUED: "等待复查",
  PROCESSING: "正在复查",
  PASSED: "已通过",
  VIOLATION: "已撤回",
  UNCERTAIN: "待人工确认",
  CANCELLED: "已取消",
  FAILED: "检测失败",
};

function statusColor(status: string) {
  switch (status) {
    case "VIOLATION":
      return "error" as const;
    case "UNCERTAIN":
      return "warning" as const;
    case "PASSED":
      return "success" as const;
    default:
      return "default" as const;
  }
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

function formatDuration(ms: number | null) {
  if (ms == null) return null;
  return `${Math.max(1, Math.round(ms / 1000))} 秒`;
}

const noRows = gridNoRowsOverlay("暂无风控记录", <GppMaybeOutlinedIcon />);

export function ContentReviewWorkspace() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();

  const pluginQuery = useQuery({
    queryKey: queryKeys.contentRisk.plugin,
    queryFn: () =>
      staffApi<PluginState>("/api/v1/admin/plugins/content-contact-risk"),
  });
  const plugin = pluginQuery.data;
  const redirecting = plugin?.enabled === false;

  useEffect(() => {
    if (redirecting) router.replace("/staff/plugins");
  }, [redirecting, router]);

  const dashboardQuery = useQuery({
    queryKey: queryKeys.contentRisk.dashboard,
    queryFn: () =>
      staffApi<Dashboard>(
        "/api/v1/admin/plugins/content-contact-risk/dashboard",
      ),
    enabled: Boolean(plugin?.enabled),
  });
  const dashboard = dashboardQuery.data ?? null;

  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [detail, setDetail] = useState<ContentRiskReviewRecord | null>(null);
  const [restoreReviewId, setRestoreReviewId] = useState<string | null>(null);
  const [restoreReason, setRestoreReason] = useState("");

  const restoreReviewMutation = useMutation({
    mutationFn: ({ reviewId, reason }: { reviewId: string; reason: string }) =>
      staffApi(
        `/api/v1/admin/plugins/content-contact-risk/reviews/${reviewId}/restore`,
        jsonRequest("POST", { reason }),
      ),
    onSuccess: async () => {
      toast.success("内容已恢复并重新释放仍有效的通知");
      setRestoreReviewId(null);
      setRestoreReason("");
      await queryClient.invalidateQueries({
        queryKey: queryKeys.contentRisk.dashboard,
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "内容恢复失败");
    },
  });

  const selectedModel = String(plugin?.config.model ?? "");
  const capabilityReport =
    dashboard?.runtime?.capabilityReport &&
    typeof dashboard.runtime.capabilityReport === "object" &&
    !Array.isArray(dashboard.runtime.capabilityReport)
      ? (dashboard.runtime.capabilityReport as Record<string, unknown>)
      : null;
  const capabilityWarnings =
    capabilityReport
      ? (Reflect.get(capabilityReport, "unsupportedMimeTypes") as
          | string[]
          | null)
      : null;
  const capabilityItems = [
    ["textCapability", "文字"],
    ["imageCapability", "图片"],
    ["pdfCapability", "PDF"],
    ["officeCapability", "Office"],
    ["animationCapability", "动图"],
  ] as const;

  const columns = useMemo<GridColDef<ContentRiskReviewRecord>[]>(
    () => [
      {
        field: "createdAt",
        headerName: "时间",
        minWidth: 165,
        flex: 0.7,
        renderCell: ({ row }) => (
          <Typography
            variant="body2"
            sx={{ fontVariantNumeric: "tabular-nums" }}
          >
            {formatTime(row.createdAt)}
          </Typography>
        ),
      },
      {
        field: "targetType",
        headerName: "类型",
        minWidth: 140,
        flex: 0.6,
        renderCell: ({ row }) => (
          <Typography variant="body2">
            {targetLabels[row.targetType] ?? row.targetType}
          </Typography>
        ),
      },
      {
        field: "actorName",
        headerName: "操作人",
        minWidth: 130,
        flex: 0.6,
        renderCell: ({ row }) => (
          <Typography variant="body2" noWrap>
            {row.actorName ?? "—"}
          </Typography>
        ),
      },
      {
        field: "status",
        headerName: "状态",
        width: 120,
        renderCell: ({ row }) => (
          <Chip
            size="small"
            label={statusLabels[row.status] ?? row.status}
            color={statusColor(row.status)}
            variant={row.status === "PASSED" ? "outlined" : "filled"}
          />
        ),
      },
      {
        field: "durationMs",
        headerName: "耗时",
        width: 90,
        renderCell: ({ row }) => (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ fontVariantNumeric: "tabular-nums" }}
          >
            {formatDuration(row.durationMs) ?? "—"}
          </Typography>
        ),
      },
      {
        field: "actions",
        headerName: "操作",
        width: 110,
        sortable: false,
        filterable: false,
        renderCell: ({ row }) =>
          row.status === "VIOLATION" && !row.restoredAt ? (
            <Button
              size="small"
              startIcon={<RestoreOutlinedIcon />}
              onClick={(event) => {
                event.stopPropagation();
                setRestoreReviewId(row.id);
                setRestoreReason("");
              }}
            >
              恢复
            </Button>
          ) : null,
      },
    ],
    [],
  );

  if (pluginQuery.isPending || redirecting) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!plugin) {
    return (
      <Alert severity="info">
        内容风控插件未安装或无法加载。请在「插件中心」确认插件状态。
      </Alert>
    );
  }

  const allReviews = dashboard?.reviews ?? [];
  const reviews = statusFilter
    ? allReviews.filter((r) => r.status === statusFilter)
    : allReviews;

  function toggleFilter(status: string) {
    setStatusFilter((current) => (current === status ? null : status));
  }

  function openRestore(reviewId: string) {
    setRestoreReviewId(reviewId);
    setRestoreReason("");
  }

  const filterChips = (
    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
      <Chip
        size="small"
        label={`待复查 ${dashboard?.counts.QUEUED ?? 0}`}
        onClick={() => toggleFilter("QUEUED")}
        variant={statusFilter === "QUEUED" ? "filled" : "outlined"}
      />
      <Chip
        size="small"
        color="error"
        label={`已撤回 ${dashboard?.counts.VIOLATION ?? 0}`}
        onClick={() => toggleFilter("VIOLATION")}
        variant={statusFilter === "VIOLATION" ? "filled" : "outlined"}
      />
      <Chip
        size="small"
        color="warning"
        label={`待确认 ${dashboard?.counts.UNCERTAIN ?? 0}`}
        onClick={() => toggleFilter("UNCERTAIN")}
        variant={statusFilter === "UNCERTAIN" ? "filled" : "outlined"}
      />
      <Chip
        size="small"
        label={
          dashboard?.stats.averageDurationMs == null
            ? "暂无耗时样本"
            : `平均 ${formatDuration(dashboard.stats.averageDurationMs)}`
        }
      />
    </Stack>
  );

  return (
    <Stack spacing={2.5}>
      {pluginQuery.isError ? (
        <Alert severity="warning">
          插件状态刷新失败，当前显示最近一次已确认的数据。
        </Alert>
      ) : null}

      {isMobile ? (
        <Stack spacing={1.5}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ justifyContent: "space-between", alignItems: "center" }}
          >
            <Typography sx={{ fontWeight: 650 }}>
              {plugin.healthStatus === "READY"
                ? "风控运行中"
                : dashboard?.runtime?.bypassedAt
                  ? "异常旁路"
                  : "未就绪"}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {selectedModel || "未选择模型"}
            </Typography>
          </Stack>
          {filterChips}
        </Stack>
      ) : (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack
            direction="row"
            spacing={2}
            sx={{
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Box>
              <Typography sx={{ fontWeight: 650 }}>
                {plugin.healthStatus === "READY"
                  ? "风控正在运行"
                  : dashboard?.runtime?.bypassedAt
                    ? "异常旁路中"
                    : "风控未就绪"}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                当前模型：{selectedModel || "未选择"}
              </Typography>
            </Box>
            <Stack spacing={1} sx={{ alignItems: "flex-end" }}>
              {filterChips}
              {capabilityReport ? (
                <Stack
                  direction="row"
                  spacing={0.75}
                  useFlexGap
                  sx={{ flexWrap: "wrap" }}
                >
                  {capabilityItems.map(([key, label]) => {
                    const value = String(
                      capabilityReport[key] ?? "UNCHECKED",
                    );
                    const ready = value === "READY";
                    return (
                      <Chip
                        key={key}
                        size="small"
                        color={ready ? "success" : "warning"}
                        variant={ready ? "filled" : "outlined"}
                        label={`${label}：${ready ? "可用" : "不完整"}`}
                      />
                    );
                  })}
                </Stack>
              ) : null}
            </Stack>
          </Stack>
        </Paper>
      )}

      {dashboard?.runtime?.bypassedAt ? (
        <Alert severity="error">
          插件处于异常旁路，所有拦截已停止，暂缓通知已释放。修复上游后重新运行环境检测才能恢复。
        </Alert>
      ) : null}

      {Array.isArray(capabilityWarnings) && capabilityWarnings.length > 0 ? (
        <Alert severity="warning">
          当前模型无法读取：{capabilityWarnings.join("、")}
          。插件仍会检查文件名和其他可读内容。
        </Alert>
      ) : null}

      {isMobile ? (
        <MobileReviewList
          reviews={reviews}
          loading={dashboardQuery.isPending}
          onSelect={setDetail}
        />
      ) : (
        <Paper variant="outlined" sx={{ p: 0 }}>
          <Box sx={{ width: "100%", height: 560 }}>
            <DataGrid
              aria-label="风控审核记录"
              rows={reviews}
              columns={columns}
              loading={dashboardQuery.isPending || dashboardQuery.isFetching}
              disableColumnFilter
              disableRowSelectionOnClick
              onRowClick={({ row }) => setDetail(row)}
              slots={{ noRowsOverlay: noRows }}
              initialState={{
                sorting: {
                  sortModel: [{ field: "createdAt", sort: "desc" }],
                },
              }}
              sx={{ ...gridSx, "& .MuiDataGrid-row": { cursor: "pointer" } }}
            />
          </Box>
        </Paper>
      )}

      <ReviewDetailDialog
        detail={detail}
        onClose={() => setDetail(null)}
        onRestore={openRestore}
      />

      <Dialog
        open={Boolean(restoreReviewId)}
        onClose={
          restoreReviewMutation.isPending
            ? undefined
            : () => setRestoreReviewId(null)
        }
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>确认 AI 误判并恢复</DialogTitle>
        <DialogContent>
          <TextField
            label="恢复原因"
            value={restoreReason}
            onChange={(event) => setRestoreReason(event.target.value)}
            helperText="原因将进入审计记录。恢复后仅重新释放仍然有效的普通通知。"
            multiline
            minRows={3}
            fullWidth
            sx={{ mt: 1 }}
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button
            onClick={() => setRestoreReviewId(null)}
            disabled={restoreReviewMutation.isPending}
          >
            取消
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              if (!restoreReviewId || restoreReason.trim().length < 2) return;
              restoreReviewMutation.mutate({
                reviewId: restoreReviewId,
                reason: restoreReason.trim(),
              });
            }}
            disabled={
              restoreReviewMutation.isPending ||
              restoreReason.trim().length < 2
            }
          >
            {restoreReviewMutation.isPending ? "恢复中" : "确认恢复"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

function MobileReviewList({
  reviews,
  loading,
  onSelect,
}: {
  reviews: ContentRiskReviewRecord[];
  loading: boolean;
  onSelect: (review: ContentRiskReviewRecord) => void;
}) {
  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  if (reviews.length === 0) {
    return <EmptyState dense title="暂无风控记录" icon={<GppMaybeOutlinedIcon />} />;
  }

  return (
    <Paper variant="outlined" sx={{ overflow: "hidden" }}>
      <List disablePadding>
        {reviews.map((review, index) => {
          const duration = formatDuration(review.durationMs);
          const date = new Date(review.createdAt);
          const timeStr = date.toLocaleString("zh-CN", {
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          });

          return (
            <ListItem key={review.id} disablePadding divider={index < reviews.length - 1}>
              <ButtonBase
                onClick={() => onSelect(review)}
                sx={{
                  width: "100%",
                  display: "block",
                  textAlign: "left",
                  px: 2,
                  py: 1.5,
                }}
              >
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: "center" }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 650 }} noWrap>
                    {targetLabels[review.targetType] ?? review.targetType}
                  </Typography>
                  <Chip
                    size="small"
                    label={statusLabels[review.status] ?? review.status}
                    color={statusColor(review.status)}
                    variant={review.status === "PASSED" ? "outlined" : "filled"}
                    sx={{ height: 22, "& .MuiChip-label": { px: 1, fontSize: "0.7rem" } }}
                  />
                </Stack>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ mt: 0.25, display: "block" }}
                >
                  {review.actorName ?? "未知"} · {timeStr}
                  {duration ? ` · ${duration}` : ""}
                </Typography>
                {review.decisionReason ? (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    noWrap
                    sx={{ mt: 0.25, display: "block" }}
                  >
                    {review.decisionReason}
                  </Typography>
                ) : null}
              </ButtonBase>
            </ListItem>
          );
        })}
      </List>
    </Paper>
  );
}

function ReviewDetailDialog({
  detail,
  onClose,
  onRestore,
}: {
  detail: ContentRiskReviewRecord | null;
  onClose: () => void;
  onRestore: (reviewId: string) => void;
}) {
  const snapshotText = detail?.contentSnapshot
    ? [
        detail.contentSnapshot.title,
        detail.contentSnapshot.body
          ? htmlToPlainText(detail.contentSnapshot.body)
          : null,
      ]
        .filter(Boolean)
        .join("\n") || "仅包含附件"
    : null;

  const riskCategories =
    detail?.riskCategories &&
    typeof detail.riskCategories === "object" &&
    Array.isArray(detail.riskCategories)
      ? (detail.riskCategories as string[])
      : null;

  const canRestore = detail?.status === "VIOLATION" && !detail.restoredAt;

  return (
    <Dialog open={Boolean(detail)} onClose={onClose} fullWidth maxWidth="sm">
      {detail && (
        <>
          <DialogTitle>
            {targetLabels[detail.targetType] ?? detail.targetType} ·{" "}
            {statusLabels[detail.status] ?? detail.status}
          </DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              <DetailRow
                label="时间"
                value={formatTime(detail.createdAt)}
              />
              {detail.completedAt ? (
                <DetailRow
                  label="完成时间"
                  value={formatTime(detail.completedAt)}
                />
              ) : null}
              <DetailRow label="操作人" value={detail.actorName} />
              {detail.durationMs != null ? (
                <DetailRow
                  label="处理耗时"
                  value={formatDuration(detail.durationMs)}
                />
              ) : null}
              {detail.decisionReason ? (
                <DetailRow label="模型判断" value={detail.decisionReason} />
              ) : null}
              {riskCategories && riskCategories.length > 0 ? (
                <Box>
                  <Typography variant="subtitle2" color="text.secondary">
                    风险类别
                  </Typography>
                  <Stack
                    direction="row"
                    spacing={0.75}
                    sx={{ mt: 0.5, flexWrap: "wrap" }}
                    useFlexGap
                  >
                    {riskCategories.map((cat) => (
                      <Chip key={cat} size="small" label={cat} variant="outlined" />
                    ))}
                  </Stack>
                </Box>
              ) : null}
              {detail.lastError ? (
                <DetailRow label="最近错误" value={detail.lastError} />
              ) : null}
              {detail.restoredAt ? (
                <>
                  <DetailRow
                    label="恢复时间"
                    value={formatTime(detail.restoredAt)}
                  />
                  {detail.restoreReason ? (
                    <DetailRow label="恢复原因" value={detail.restoreReason} />
                  ) : null}
                </>
              ) : null}
              <DetailRow
                label="服务请求 ID"
                value={detail.serviceRequestId}
                mono
              />
              {snapshotText ? (
                <Box>
                  <Typography variant="subtitle2" color="text.secondary">
                    原始内容
                  </Typography>
                  <Box
                    sx={{
                      mt: 0.75,
                      p: 1.5,
                      bgcolor: "action.hover",
                      borderRadius: 1.5,
                      maxHeight: 240,
                      overflowY: "auto",
                    }}
                  >
                    <Typography
                      variant="body2"
                      sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                    >
                      {snapshotText}
                    </Typography>
                  </Box>
                </Box>
              ) : null}
            </Stack>
          </DialogContent>
          {canRestore ? (
            <DialogActions sx={{ px: 3, pb: 2.5 }}>
              <Button onClick={onClose}>关闭</Button>
              <Button
                variant="contained"
                color="error"
                startIcon={<RestoreOutlinedIcon />}
                onClick={() => {
                  onClose();
                  onRestore(detail.id);
                }}
              >
                确认误判并恢复
              </Button>
            </DialogActions>
          ) : null}
        </>
      )}
    </Dialog>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <Box>
      <Typography variant="subtitle2" color="text.secondary">
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          mt: 0.25,
          overflowWrap: "anywhere",
          ...(mono ? { fontFamily: "ui-monospace, monospace" } : {}),
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}
