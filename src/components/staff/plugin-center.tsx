"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ExtensionOutlinedIcon from "@mui/icons-material/ExtensionOutlined";
import ExpandMoreOutlinedIcon from "@mui/icons-material/ExpandMoreOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";
import { useRealtimeRouteRefresh } from "@/hooks/use-realtime-route-refresh";

type PluginRunView = {
  id: string;
  kind: string;
  status:
    | "QUEUED"
    | "RUNNING"
    | "PAUSED"
    | "COMPLETED"
    | "FAILED"
    | "CANCELLED";
  totalCount: number;
  processedCount: number;
  successCount: number;
  skippedCount: number;
  failedCount: number;
  sourceBytes: string;
  outputBytes: string;
  savedBytes: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PluginView = {
  key: string;
  name: string;
  description: string;
  version: string;
  category: string;
  minimumPlatformVersion: string;
  capabilities: string[];
  enabled: boolean;
  config: Record<string, unknown>;
  healthStatus: string;
  lastCheckedAt: string | null;
  lastError: string | null;
  updatedAt: string;
  settings: Array<{
    key: string;
    type: "number" | "boolean";
    label: string;
    description: string;
    min?: number;
    max?: number;
    step?: number;
  }>;
  runs: PluginRunView[];
};

const pluginEvents = ["PLUGIN_RUN_UPDATED"] as const;

export function PluginCenter({ plugins }: { plugins: PluginView[] }) {
  const router = useRouter();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [confirmMigrationKey, setConfirmMigrationKey] = useState<string | null>(
    null,
  );
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const selected = useMemo(
    () => plugins.find((plugin) => plugin.key === selectedKey) ?? null,
    [plugins, selectedKey],
  );

  useRealtimeRouteRefresh({ eventTypes: pluginEvents });

  function openSettings(plugin: PluginView) {
    setSelectedKey(plugin.key);
    setConfig(plugin.config);
    setError("");
    setSuccess("");
  }

  async function saveConfig() {
    if (!selected) return;
    await execute("save", async () => {
      await staffApi(
        `/api/v1/admin/plugins/${selected.key}`,
        jsonRequest("PATCH", { config }),
      );
      setSuccess("插件配置已保存");
    });
  }

  async function checkHealth() {
    if (!selected) return;
    await execute("check", async () => {
      await staffApi(
        `/api/v1/admin/plugins/${selected.key}/check`,
        jsonRequest("POST"),
      );
      setSuccess("环境检测已完成");
    });
  }

  async function toggleEnabled() {
    if (!selected) return;
    await execute("toggle", async () => {
      await staffApi(
        `/api/v1/admin/plugins/${selected.key}`,
        jsonRequest("PATCH", { enabled: !selected.enabled }),
      );
      setSuccess(selected.enabled ? "插件已停用" : "插件已启用");
    });
  }

  async function startMigration(pluginKey: string) {
    await execute("start", async () => {
      await staffApi(
        `/api/v1/admin/plugins/${pluginKey}/runs`,
        jsonRequest("POST"),
      );
      setConfirmMigrationKey(null);
      setSelectedKey(pluginKey);
      setSuccess("历史图片迁移已加入后台队列");
    });
  }

  async function controlRun(
    pluginKey: string,
    runId: string,
    action: "pause" | "resume" | "cancel",
  ) {
    await execute(`${runId}:${action}`, async () => {
      await staffApi(
        `/api/v1/admin/plugins/${pluginKey}/runs/${runId}`,
        jsonRequest("PATCH", { action }),
      );
      setSuccess(
        action === "pause"
          ? "任务已暂停"
          : action === "resume"
            ? "任务已继续"
            : "任务已取消",
      );
    });
  }

  async function execute(key: string, action: () => Promise<void>) {
    setBusy(key);
    setError("");
    setSuccess("");
    try {
      await action();
      router.refresh();
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "插件操作失败",
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <Stack spacing={2.5}>
      <Paper variant="outlined" sx={{ overflow: "hidden" }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          sx={{
            px: { xs: 2, sm: 2.5 },
            py: 2.25,
            alignItems: { sm: "center" },
            justifyContent: "space-between",
          }}
        >
          <Box>
            <Typography sx={{ fontWeight: 700 }}>已安装插件</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              插件随平台版本部署，代码来源由构建白名单控制。
            </Typography>
          </Box>
          <Chip label={`${plugins.length} 个`} />
        </Stack>
      </Paper>

      {plugins.length === 0 ? (
        <EmptyState />
      ) : (
        <Paper variant="outlined" sx={{ overflow: "hidden" }}>
          {plugins.map((plugin, index) => (
            <Box key={plugin.key}>
              {index > 0 ? <Divider /> : null}
              <PluginRow
                plugin={plugin}
                onSettings={() => openSettings(plugin)}
              />
            </Box>
          ))}
        </Paper>
      )}

      <Dialog
        open={Boolean(selected)}
        onClose={busy ? undefined : () => setSelectedKey(null)}
        fullWidth
        maxWidth="sm"
      >
        {busy ? <LinearProgress /> : null}
        <DialogTitle>{selected?.name}</DialogTitle>
        <DialogContent>
          {selected ? (
            <Stack spacing={2.25} sx={{ pt: 0.5 }}>
              {error ? <Alert severity="error">{error}</Alert> : null}
              {success ? <Alert severity="success">{success}</Alert> : null}
              <PluginStatusSummary plugin={selected} />
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1}
                sx={{ alignItems: { sm: "center" } }}
              >
                <Button
                  variant="outlined"
                  onClick={() => void checkHealth()}
                  disabled={Boolean(busy)}
                >
                  运行环境检测
                </Button>
                <Button
                  variant={selected.enabled ? "outlined" : "contained"}
                  color={selected.enabled ? "inherit" : "primary"}
                  onClick={() => void toggleEnabled()}
                  disabled={Boolean(busy)}
                >
                  {selected.enabled ? "停用插件" : "启用插件"}
                </Button>
              </Stack>

              <Accordion variant="outlined" disableGutters>
                <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
                  <Typography sx={{ fontWeight: 650 }}>转换配置</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Stack spacing={2}>
                    {selected.settings.map((field) =>
                      field.type === "number" ? (
                        <TextField
                          key={field.key}
                          type="number"
                          label={field.label}
                          value={Number(config[field.key] ?? 0)}
                          onChange={(event) =>
                            setConfig((current) => ({
                              ...current,
                              [field.key]: Number(event.target.value),
                            }))
                          }
                          helperText={field.description}
                          slotProps={{
                            htmlInput: {
                              min: field.min,
                              max: field.max,
                              step: field.step ?? 1,
                            },
                          }}
                          fullWidth
                        />
                      ) : null,
                    )}
                    <Button
                      variant="contained"
                      onClick={() => void saveConfig()}
                      disabled={Boolean(busy)}
                    >
                      保存配置
                    </Button>
                  </Stack>
                </AccordionDetails>
              </Accordion>

              <Accordion variant="outlined" disableGutters>
                <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
                  <Typography sx={{ fontWeight: 650 }}>
                    历史图片迁移
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Stack spacing={1.5}>
                    <Alert severity="warning">
                      转换成功后不保留原始字节。任务单并发运行，可暂停或取消。
                    </Alert>
                    {selected.runs.length > 0 ? (
                      <RunCard
                        pluginKey={selected.key}
                        run={selected.runs[0]}
                        busy={busy}
                        onControl={controlRun}
                      />
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        尚未执行历史迁移。
                      </Typography>
                    )}
                    <Button
                      variant="outlined"
                      onClick={() => setConfirmMigrationKey(selected.key)}
                      disabled={!selected.enabled || Boolean(busy)}
                    >
                      启动新的历史迁移
                    </Button>
                  </Stack>
                </AccordionDetails>
              </Accordion>
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setSelectedKey(null)} disabled={Boolean(busy)}>
            关闭
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(confirmMigrationKey)}
        onClose={busy ? undefined : () => setConfirmMigrationKey(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>确认迁移历史图片</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mt: 0.5 }}>
            系统将限速扫描已有 JPEG、PNG。只有 WebP 至少缩小 5%
            且验证有效时才会替换，替换后不保留原图副本。
          </Alert>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button
            onClick={() => setConfirmMigrationKey(null)}
            disabled={Boolean(busy)}
          >
            取消
          </Button>
          <Button
            variant="contained"
            onClick={() =>
              confirmMigrationKey
                ? void startMigration(confirmMigrationKey)
                : undefined
            }
            disabled={Boolean(busy)}
          >
            加入后台队列
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

function PluginRow({
  plugin,
  onSettings,
}: {
  plugin: PluginView;
  onSettings: () => void;
}) {
  const latestRun = plugin.runs[0];
  return (
    <Stack
      direction={{ xs: "column", md: "row" }}
      spacing={2}
      sx={{
        px: { xs: 2, sm: 2.5 },
        py: 2.25,
        alignItems: { md: "center" },
        justifyContent: "space-between",
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ alignItems: "center", flexWrap: "wrap" }}
        >
          <Typography sx={{ fontWeight: 700 }}>{plugin.name}</Typography>
          <Chip
            size="small"
            label={plugin.enabled ? "已启用" : "未启用"}
            color={plugin.enabled ? "success" : "default"}
          />
          <Chip size="small" variant="outlined" label={`v${plugin.version}`} />
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {plugin.description}
        </Typography>
        {latestRun ? (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mt: 0.75 }}
          >
            最近任务：{runStatusLabel(latestRun.status)} · 已处理{" "}
            {latestRun.processedCount}/{latestRun.totalCount}
          </Typography>
        ) : null}
      </Box>
      <Button
        variant="outlined"
        startIcon={<SettingsOutlinedIcon />}
        onClick={onSettings}
        sx={{ alignSelf: { xs: "stretch", md: "center" }, flexShrink: 0 }}
      >
        管理
      </Button>
    </Stack>
  );
}

function PluginStatusSummary({ plugin }: { plugin: PluginView }) {
  const ready = plugin.healthStatus === "READY";
  return (
    <Stack
      spacing={1}
      sx={{
        p: 1.75,
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography sx={{ fontWeight: 700 }}>运行状态</Typography>
        <Chip
          size="small"
          label={ready ? "环境正常" : "尚未通过检测"}
          color={ready ? "success" : "default"}
        />
      </Stack>
      <Typography variant="body2" color="text.secondary">
        {plugin.lastError ||
          (plugin.lastCheckedAt
            ? `最后检测：${formatDate(plugin.lastCheckedAt)}`
            : "启用前需要完成一次运行环境检测。")}
      </Typography>
    </Stack>
  );
}

function RunCard({
  pluginKey,
  run,
  busy,
  onControl,
}: {
  pluginKey: string;
  run: PluginRunView;
  busy: string;
  onControl: (
    pluginKey: string,
    runId: string,
    action: "pause" | "resume" | "cancel",
  ) => Promise<void>;
}) {
  const progress =
    run.totalCount > 0
      ? Math.min(100, (run.processedCount / run.totalCount) * 100)
      : run.status === "COMPLETED"
        ? 100
        : 0;
  const active = ["QUEUED", "RUNNING", "PAUSED"].includes(run.status);
  return (
    <Stack
      spacing={1.25}
      sx={{
        p: 1.5,
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", justifyContent: "space-between" }}
      >
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {runStatusLabel(run.status)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {run.processedCount}/{run.totalCount}
        </Typography>
      </Stack>
      <LinearProgress variant="determinate" value={progress} />
      <Typography variant="caption" color="text.secondary">
        已转换 {run.successCount} · 跳过 {run.skippedCount} · 失败{" "}
        {run.failedCount} · 节省 {formatBytes(run.savedBytes)}
      </Typography>
      {run.lastError ? <Alert severity="error">{run.lastError}</Alert> : null}
      {active ? (
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
          {run.status === "PAUSED" ? (
            <Button
              size="small"
              onClick={() => void onControl(pluginKey, run.id, "resume")}
              disabled={Boolean(busy)}
            >
              继续
            </Button>
          ) : (
            <Button
              size="small"
              onClick={() => void onControl(pluginKey, run.id, "pause")}
              disabled={Boolean(busy)}
            >
              暂停
            </Button>
          )}
          <Button
            size="small"
            color="inherit"
            onClick={() => void onControl(pluginKey, run.id, "cancel")}
            disabled={Boolean(busy)}
          >
            取消任务
          </Button>
        </Stack>
      ) : null}
    </Stack>
  );
}

function EmptyState() {
  return (
    <Paper
      variant="outlined"
      sx={{
        minHeight: 280,
        display: "grid",
        placeItems: "center",
        px: 3,
        py: 6,
        textAlign: "center",
      }}
    >
      <Stack spacing={1.25} sx={{ alignItems: "center", maxWidth: 420 }}>
        <ExtensionOutlinedIcon color="action" />
        <Typography variant="h3">暂无插件</Typography>
        <Typography color="text.secondary">
          受信任并随平台构建的插件会显示在这里。
        </Typography>
      </Stack>
    </Paper>
  );
}

function runStatusLabel(status: PluginRunView["status"]) {
  return {
    QUEUED: "等待执行",
    RUNNING: "正在迁移",
    PAUSED: "已暂停",
    COMPLETED: "已完成",
    FAILED: "失败",
    CANCELLED: "已取消",
  }[status];
}

function formatBytes(value: string) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
