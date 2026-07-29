"use client";

import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import {
  ContentRiskHistoryDialog,
  type ContentRiskReviewRecord,
} from "@/components/staff/content-risk-history-dialog";
import { useToast } from "@/components/shared/toast-provider";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";

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

export function ContentRiskPluginSettings({
  enabled,
  healthStatus,
  config,
  secrets,
  hasApiKey,
  busy,
  onConfigChange,
  onSecretChange,
  onSave,
  readOnly = false,
}: {
  enabled: boolean;
  healthStatus: string;
  config: Record<string, unknown>;
  secrets?: Record<string, string>;
  hasApiKey?: boolean;
  busy?: boolean;
  onConfigChange?: (next: Record<string, unknown>) => void;
  onSecretChange?: (key: string, value: string) => void;
  onSave?: () => Promise<void>;
  readOnly?: boolean;
}) {
  const toast = useToast();
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [restoreReviewId, setRestoreReviewId] = useState<string | null>(null);
  const [restoreReason, setRestoreReason] = useState("");
  const [restoring, setRestoring] = useState(false);

  async function loadDashboard() {
    const result = await staffApi<Dashboard>(
      "/api/v1/admin/plugins/content-contact-risk/dashboard",
    );
    setDashboard(result);
  }

  useEffect(() => {
    if (!enabled && healthStatus === "UNKNOWN") return;
    const timer = window.setTimeout(() => {
      void loadDashboard().catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [enabled, healthStatus]);

  async function discoverModels() {
    if (readOnly || !onConfigChange) return;
    const baseUrl = String(config.baseUrl ?? "").trim();
    if (!baseUrl) {
      toast.warning("请先填写模型 Base URL");
      return;
    }
    if (!hasApiKey && !secrets?.apiKey?.trim()) {
      toast.warning("请先填写 API Key");
      return;
    }
    setLoadingModels(true);
    try {
      const result = await staffApi<{ models: string[] }>(
        "/api/v1/admin/plugins/content-contact-risk/models",
        jsonRequest("POST", {
          baseUrl,
          ...(secrets?.apiKey?.trim() ? { apiKey: secrets.apiKey.trim() } : {}),
        }),
      );
      const discoveredModels = result.models;
      setModels(discoveredModels);
      if (
        discoveredModels.length === 1 &&
        !String(config.model ?? "").trim()
      ) {
        onConfigChange({ ...config, model: discoveredModels[0] });
      }
      toast.success(`已获取 ${discoveredModels.length} 个模型`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "获取模型失败");
    } finally {
      setLoadingModels(false);
    }
  }

  async function confirmRestoreReview() {
    if (!restoreReviewId || restoreReason.trim().length < 2) return;
    setRestoring(true);
    try {
      await staffApi(
        `/api/v1/admin/plugins/content-contact-risk/reviews/${restoreReviewId}/restore`,
        jsonRequest("POST", { reason: restoreReason.trim() }),
      );
      toast.success("内容已恢复并重新释放仍有效的通知");
      setRestoreReviewId(null);
      setRestoreReason("");
      await loadDashboard();
    } finally {
      setRestoring(false);
    }
  }

  const selectedModel = String(config.model ?? "");
  const modelOptions = [...new Set([selectedModel, ...models].filter(Boolean))];
  const capabilityWarnings =
    dashboard?.runtime?.capabilityReport &&
    typeof dashboard.runtime.capabilityReport === "object" &&
    !Array.isArray(dashboard.runtime.capabilityReport)
      ? Reflect.get(dashboard.runtime.capabilityReport, "unsupportedMimeTypes")
      : null;
  const capabilityReport =
    dashboard?.runtime?.capabilityReport &&
    typeof dashboard.runtime.capabilityReport === "object" &&
    !Array.isArray(dashboard.runtime.capabilityReport)
      ? (dashboard.runtime.capabilityReport as Record<string, unknown>)
      : null;
  const capabilityItems = [
    ["textCapability", "文字"],
    ["imageCapability", "图片"],
    ["pdfCapability", "PDF"],
    ["officeCapability", "Office"],
    ["animationCapability", "动图"],
  ] as const;

  return (
    <Stack spacing={2}>
      {enabled && healthStatus === "READY" ? (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 1 }}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            sx={{ justifyContent: "space-between" }}
          >
            <Box>
              <Typography sx={{ fontWeight: 700 }}>风控正在运行</Typography>
              <Typography variant="body2" color="text.secondary">
                当前模型：{selectedModel || "未选择"}
              </Typography>
            </Box>
            <Stack spacing={1} sx={{ alignItems: { sm: "flex-end" } }}>
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
                <Chip size="small" label={`待复查 ${dashboard?.counts.QUEUED ?? 0}`} />
                <Chip size="small" color="error" label={`已撤回 ${dashboard?.counts.VIOLATION ?? 0}`} />
                <Chip size="small" color="warning" label={`待确认 ${dashboard?.counts.UNCERTAIN ?? 0}`} />
                <Chip
                  size="small"
                  label={
                    dashboard?.stats.averageDurationMs == null
                      ? "暂无耗时样本"
                      : `平均 ${Math.max(1, Math.round(dashboard.stats.averageDurationMs / 1000))} 秒`
                  }
                />
              </Stack>
              <Button
                size="small"
                variant="outlined"
                startIcon={<HistoryOutlinedIcon />}
                onClick={() => setHistoryOpen(true)}
                disabled={!dashboard}
              >
                查看历史风控
              </Button>
            </Stack>
          </Stack>
        </Paper>
      ) : null}

      {Array.isArray(capabilityWarnings) && capabilityWarnings.length > 0 ? (
        <Alert severity="warning">
          当前模型无法读取：{capabilityWarnings.join("、")}。插件仍会检查文件名和其他可读内容。
        </Alert>
      ) : null}

      {dashboard?.runtime?.bypassedAt ? (
        <Alert severity="error">
          插件处于异常旁路，所有拦截已停止，暂缓通知已释放。修复上游后重新运行环境检测才能恢复。
        </Alert>
      ) : null}

      {capabilityReport ? (
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
          {capabilityItems.map(([key, label]) => {
            const value = String(capabilityReport[key] ?? "UNCHECKED");
            const ready = value === "READY";
            return (
              <Chip
                key={key}
                size="small"
                color={ready ? "success" : "warning"}
                variant={ready ? "filled" : "outlined"}
                label={`${label}：${ready ? "可用" : "能力不完整"}`}
              />
            );
          })}
        </Stack>
      ) : null}

      {!readOnly && onConfigChange && onSecretChange && onSave ? (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 1 }}>
          <Stack spacing={2}>
            <TextField
              label="模型 Base URL"
              value={String(config.baseUrl ?? "")}
              onChange={(event) =>
                onConfigChange({ ...config, baseUrl: event.target.value })
              }
              helperText="系统使用该地址的 /v1/models 和 /v1/responses。"
              fullWidth
            />
            <TextField
              type="password"
              label="API Key"
              value={secrets?.apiKey ?? ""}
              onChange={(event) =>
                onSecretChange("apiKey", event.target.value)
              }
              helperText={
                hasApiKey
                  ? "已加密保存；留空表示不修改"
                  : "密钥仅在服务端使用"
              }
              autoComplete="new-password"
              fullWidth
            />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <FormControl fullWidth>
                <InputLabel id="content-risk-model-label">检测模型</InputLabel>
                <Select
                  labelId="content-risk-model-label"
                  label="检测模型"
                  value={selectedModel}
                  onChange={(event) =>
                    onConfigChange({ ...config, model: event.target.value })
                  }
                >
                  {modelOptions.map((model) => (
                    <MenuItem key={model} value={model}>
                      {model}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button
                variant="outlined"
                startIcon={<RefreshOutlinedIcon />}
                onClick={() => void discoverModels()}
                disabled={busy || loadingModels}
                sx={{ flexShrink: 0 }}
              >
                获取模型
              </Button>
            </Stack>
            <FormControlLabel
              control={
                <Switch
                  checked={config.fullAuditEnabled !== false}
                  onChange={(event) =>
                    onConfigChange({
                      ...config,
                      fullAuditEnabled: event.target.checked,
                    })
                  }
                />
              }
              label="开启后新内容全量发送后复查"
            />
            <Typography variant="body2" color="text.secondary">
              仅复查本次启用后的新内容和新编辑版本，不检查历史数据。
            </Typography>
            <Button
              variant="contained"
              onClick={() => void onSave()}
              disabled={busy}
            >
              保存配置
            </Button>
          </Stack>
        </Paper>
      ) : null}

      <ContentRiskHistoryDialog
        open={enabled && historyOpen}
        reviews={dashboard?.reviews ?? []}
        onClose={() => setHistoryOpen(false)}
        onRestore={(reviewId) => {
          setHistoryOpen(false);
          setRestoreReviewId(reviewId);
          setRestoreReason("");
        }}
      />

      <Dialog
        open={Boolean(restoreReviewId)}
        onClose={restoring ? undefined : () => setRestoreReviewId(null)}
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
          <Button onClick={() => setRestoreReviewId(null)} disabled={restoring}>
            取消
          </Button>
          <Button
            variant="contained"
            onClick={() => void confirmRestoreReview()}
            disabled={restoring || restoreReason.trim().length < 2}
          >
            {restoring ? "恢复中" : "确认恢复"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
