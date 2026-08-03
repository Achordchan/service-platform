"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import ExtensionOutlinedIcon from "@mui/icons-material/ExtensionOutlined";
import ArrowForwardOutlinedIcon from "@mui/icons-material/ArrowForwardOutlined";
import ExpandMoreOutlinedIcon from "@mui/icons-material/ExpandMoreOutlined";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import SendOutlinedIcon from "@mui/icons-material/SendOutlined";
import type {
  DingTalkRobotConfig,
  DingTalkRobotEventType,
  DingTalkRobotTemplate,
} from "@achord/plugin-dingtalk-robot/config";
import { DingTalkTemplateSettings } from "@/components/staff/dingtalk-template-settings";
import { ContentRiskPluginSettings } from "@/components/staff/content-risk-plugin-settings";
import { PluginDeveloperGuideDialog } from "@/components/staff/plugin-developer-guide-dialog";
import { PluginSettingsForm } from "@/components/staff/plugin-settings-form";
import { useToast } from "@/components/shared/toast-provider";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";
import { useRealtimeRouteRefresh } from "@/hooks/use-realtime-route-refresh";
import { queryKeys } from "@/lib/query-keys";

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
  configuredSecretKeys: string[];
  secretConfigState: "MISSING" | "VALID" | "INVALID";
  healthStatus: string;
  lastCheckedAt: string | null;
  lastError: string | null;
  updatedAt: string;
  settings: Array<{
    key: string;
    type:
      | "number"
      | "boolean"
      | "secret-url"
      | "url"
      | "text"
      | "secret-text"
      | "dynamic-select";
    label: string;
    description: string;
    min?: number;
    max?: number;
    step?: number;
    required?: boolean;
    placeholder?: string;
    actionKey?: string;
  }>;
  actions?: Array<{
    key: string;
    label: string;
    description: string;
    destructive?: boolean;
  }>;
  runs: PluginRunView[];
};

export function hasPluginSettings(
  plugin: Pick<PluginView, "settings">,
) {
  return plugin.settings.length > 0;
}

export function supportsPluginAction(
  plugin: Pick<PluginView, "actions">,
  actionKey: string,
) {
  return plugin.actions?.some((action) => action.key === actionKey) === true;
}

export function requiresPluginConfiguration(
  plugin: Pick<
    PluginView,
    "settings" | "configuredSecretKeys" | "secretConfigState"
  >,
) {
  return (
    plugin.secretConfigState === "MISSING" &&
    plugin.settings.some(
      (field) =>
        (field.type === "secret-url" || field.type === "secret-text") &&
        field.required &&
        !plugin.configuredSecretKeys.includes(field.key),
    )
  );
}

const pluginEvents = ["PLUGIN_RUN_UPDATED"] as const;

export function PluginCenter({ plugins }: { plugins: PluginView[] }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [confirmMigrationKey, setConfirmMigrationKey] = useState<string | null>(
    null,
  );
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const actionMutation = useMutation({
    mutationFn: ({ run }: { key: string; run: () => Promise<void> }) => run(),
  });
  const busy = actionMutation.isPending
    ? (actionMutation.variables?.key ?? "action")
    : "";
  const [guideOpen, setGuideOpen] = useState(false);
  const selected = useMemo(
    () => plugins.find((plugin) => plugin.key === selectedKey) ?? null,
    [plugins, selectedKey],
  );
  const selectedRequiresConfiguration = selected
    ? requiresPluginConfiguration(selected)
    : false;

  useRealtimeRouteRefresh({ eventTypes: pluginEvents });

  function openSettings(plugin: PluginView) {
    setSelectedKey(plugin.key);
    setConfig(plugin.config);
    setSecrets({});
  }

  async function saveConfig(
    nextConfig = config,
    nextSecrets = secrets,
  ) {
    if (!selected) return false;
    const missingRequiredFields = selected.settings.filter(
      (field) =>
        (field.type === "secret-url" || field.type === "secret-text") &&
        field.required &&
        !selected.configuredSecretKeys.includes(field.key) &&
        !nextSecrets[field.key]?.trim(),
    );
    if (missingRequiredFields.length > 0) {
      toast.warning(`请填写${missingRequiredFields[0]?.label ?? "必填配置"}`);
      return false;
    }
    return execute("save", async () => {
      const changedSecrets = Object.fromEntries(
        Object.entries(nextSecrets).filter(([, value]) => value.trim().length > 0),
      );
      await staffApi(
        `/api/v1/admin/plugins/${selected.key}`,
        jsonRequest("PATCH", {
          config: nextConfig,
          ...(Object.keys(changedSecrets).length > 0
            ? { secrets: changedSecrets }
            : {}),
        }),
      );
      setConfig(nextConfig);
      setSecrets({});
      toast.success("插件配置已保存");
    });
  }

  async function checkHealth() {
    if (!selected) return;
    await execute("check", async () => {
      const result = await staffApi<{
        healthStatus: string;
        lastError: string | null;
      }>(
        `/api/v1/admin/plugins/${selected.key}/check`,
        jsonRequest("POST"),
      );
      if (result.healthStatus === "READY") {
        toast.success("运行环境检测通过");
      } else {
        toast.error(result.lastError || "运行环境检测未通过");
      }
    });
  }

  async function toggleEnabled() {
    if (!selected) return;
    await execute("toggle", async () => {
      await staffApi(
        `/api/v1/admin/plugins/${selected.key}`,
        jsonRequest("PATCH", { enabled: !selected.enabled }),
      );
      toast.success(selected.enabled ? "插件已停用" : "插件已启用");
    });
  }

  async function sendTestMessage() {
    if (!selected) return;
    await execute("test-message", async () => {
      await staffApi(
        `/api/v1/admin/plugins/${selected.key}/test-message`,
        jsonRequest("POST", {}),
      );
      toast.success("测试消息已提交，请在钉钉群中查看");
    });
  }

  async function saveDingTalkTemplates(nextConfig: DingTalkRobotConfig) {
    if (!selected) return false;
    const saved = await execute("template-save", async () => {
      await staffApi(
        `/api/v1/admin/plugins/${selected.key}`,
        jsonRequest("PATCH", { config: nextConfig }),
      );
      setConfig(nextConfig);
      toast.success("钉钉通知模板已保存");
    });
    return saved;
  }

  async function sendDingTalkTemplateTest(
    eventType: DingTalkRobotEventType,
    template: DingTalkRobotTemplate,
  ) {
    if (!selected) return;
    await execute(`template-test:${eventType}`, async () => {
      await staffApi(
        `/api/v1/admin/plugins/${selected.key}/test-message`,
        jsonRequest("POST", { eventType, template }),
      );
      toast.success("模板测试消息已提交，请在钉钉群中查看");
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
      toast.success("历史图片迁移已加入后台队列");
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
      toast.success(
        action === "pause"
          ? "任务已暂停"
          : action === "resume"
            ? "任务已继续"
            : "任务已取消",
      );
    });
  }

  async function execute(key: string, action: () => Promise<void>) {
    try {
      await actionMutation.mutateAsync({ key, run: action });
      return true;
    } catch (actionError) {
      toast.error(
        actionError instanceof Error ? actionError.message : "插件操作失败",
      );
      return false;
    } finally {
      if (selected?.key === "dingtalk-robot") {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.plugins.dingtalk,
        });
      }
      if (selected?.key === "content-contact-risk") {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.contentRisk.plugin,
        });
      }
      router.refresh();
    }
  }

  return (
    <Stack spacing={2.5}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        sx={{
          alignItems: { sm: "center" },
          justifyContent: "space-between",
        }}
      >
        <Box>
          <Typography sx={{ fontWeight: 700 }}>已安装插件</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>
            共 {plugins.length} 个受信任扩展
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<MenuBookOutlinedIcon />}
          onClick={() => setGuideOpen(true)}
        >
          插件开发规范
        </Button>
      </Stack>

      {plugins.length === 0 ? (
        <EmptyState />
      ) : (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "minmax(0, 1fr)",
              sm: "repeat(auto-fill, minmax(240px, 280px))",
            },
            justifyContent: "start",
            gap: 1.5,
          }}
        >
          {plugins.map((plugin) => (
            <PluginCard
              key={plugin.key}
              plugin={plugin}
              onOpen={() => openSettings(plugin)}
            />
          ))}
        </Box>
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
              <PluginStatusSummary plugin={selected} />
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1}
                sx={{ alignItems: { sm: "center" } }}
              >
                <Button
                  variant="outlined"
                  onClick={() => void checkHealth()}
                  disabled={Boolean(busy) || selectedRequiresConfiguration}
                >
                  运行环境检测
                </Button>
                <Button
                  variant={selected.enabled ? "outlined" : "contained"}
                  color={selected.enabled ? "inherit" : "primary"}
                  onClick={() => void toggleEnabled()}
                  disabled={
                    Boolean(busy) ||
                    (selectedRequiresConfiguration && !selected.enabled)
                  }
                >
                  {selected.enabled ? "停用插件" : "启用插件"}
                </Button>
                {supportsPluginAction(selected, "send-test-message") ? (
                  <Button
                    variant="outlined"
                    startIcon={<SendOutlinedIcon />}
                    onClick={() => void sendTestMessage()}
                    disabled={
                      Boolean(busy) || selected.secretConfigState !== "VALID"
                    }
                  >
                    发送测试消息
                  </Button>
                ) : null}
              </Stack>

              {selected.key === "content-contact-risk" ? (
                <ContentRiskPluginSettings
                  enabled={selected.enabled}
                  healthStatus={selected.healthStatus}
                  config={config}
                  secrets={secrets}
                  hasApiKey={selected.configuredSecretKeys.includes("apiKey")}
                  busy={Boolean(busy)}
                  onConfigChange={setConfig}
                  onSecretChange={(key, value) =>
                    setSecrets((current) => ({ ...current, [key]: value }))
                  }
                  onSave={async () => {
                    await saveConfig();
                  }}
                />
              ) : hasPluginSettings(selected) ? (
                <Accordion
                  variant="outlined"
                  disableGutters
                  defaultExpanded={selectedRequiresConfiguration}
                >
                  <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
                    <Typography sx={{ fontWeight: 650 }}>插件设置</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <PluginSettingsForm
                      plugin={selected}
                      initialConfig={config}
                      initialSecrets={secrets}
                      busy={Boolean(busy)}
                      onSave={saveConfig}
                    />
                  </AccordionDetails>
                </Accordion>
              ) : null}

              {selected.key === "dingtalk-robot" ? (
                <DingTalkTemplateSettings
                  config={config}
                  busy={Boolean(busy)}
                  canTest={selected.secretConfigState === "VALID"}
                  onSave={saveDingTalkTemplates}
                  onTest={sendDingTalkTemplateTest}
                />
              ) : null}

              {supportsPluginAction(selected, "migrate-history") &&
              ((selected.enabled && selected.healthStatus === "READY") ||
                selected.runs.length > 0) ? (
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
                      {selected.enabled &&
                      selected.healthStatus === "READY" ? (
                        <Button
                          variant="outlined"
                          onClick={() => setConfirmMigrationKey(selected.key)}
                          disabled={Boolean(busy)}
                        >
                          启动新的历史迁移
                        </Button>
                      ) : null}
                    </Stack>
                  </AccordionDetails>
                </Accordion>
              ) : null}
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

      <PluginDeveloperGuideDialog
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
      />
    </Stack>
  );
}

function PluginCard({
  plugin,
  onOpen,
}: {
  plugin: PluginView;
  onOpen: () => void;
}) {
  const latestRun = plugin.runs[0];
  const configurationRequired = requiresPluginConfiguration(plugin);
  const healthError =
    !configurationRequired && plugin.healthStatus === "ERROR";
  const healthReady = plugin.healthStatus === "READY";
  const status = configurationRequired
    ? { label: "待配置", color: "warning" as const }
    : healthError
      ? { label: "环境异常", color: "error" as const }
      : !healthReady
        ? { label: "待检测", color: "warning" as const }
        : plugin.enabled
          ? { label: "已启用", color: "success" as const }
          : { label: "未启用", color: "default" as const };
  return (
    <Card
      variant="outlined"
      sx={{
        minWidth: 0,
        minHeight: 220,
        borderColor: healthError ? "error.light" : "divider",
      }}
    >
      <CardActionArea
        onClick={onOpen}
        aria-label={`管理${plugin.name}`}
        sx={{ height: "100%", alignItems: "stretch" }}
      >
        <CardContent sx={{ height: "100%", p: 2 }}>
          <Stack spacing={1.5} sx={{ height: "100%", minWidth: 0 }}>
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: "flex-start", justifyContent: "space-between" }}
            >
              <Box
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: 2,
                  bgcolor: "action.hover",
                  color: "text.secondary",
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                }}
              >
                <ExtensionOutlinedIcon />
              </Box>
              <Chip
                size="small"
                label={status.label}
                color={status.color}
              />
            </Stack>

            <Box sx={{ minWidth: 0 }}>
              <Stack
                direction="row"
                spacing={1}
                useFlexGap
                sx={{ alignItems: "baseline", flexWrap: "wrap" }}
              >
                <Typography sx={{ fontWeight: 750 }}>{plugin.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  v{plugin.version}
                </Typography>
              </Stack>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{
                  mt: 0.75,
                  display: "-webkit-box",
                  WebkitBoxOrient: "vertical",
                  WebkitLineClamp: 2,
                  overflow: "hidden",
                }}
              >
                {plugin.description}
              </Typography>
            </Box>

            <Stack spacing={0.75} sx={{ mt: "auto", minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary">
                {plugin.category}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 650 }}>
                {configurationRequired
                  ? "请先完成必填配置"
                  : healthError
                    ? "运行环境检测失败，打开查看原因"
                  : !healthReady
                    ? "版本已更新，需要重新检测运行环境"
                    : latestRun
                      ? `最近任务：${runStatusLabel(latestRun.status)} · ${latestRun.processedCount}/${latestRun.totalCount}`
                      : supportsPluginAction(plugin, "migrate-history")
                        ? "尚未执行后台任务"
                        : plugin.enabled
                          ? "插件正在运行"
                          : "运行环境已就绪"}
              </Typography>
              <Stack
                direction="row"
                spacing={0.5}
                sx={{ alignItems: "center", color: "primary.main", pt: 0.25 }}
              >
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  管理插件
                </Typography>
                <ArrowForwardOutlinedIcon fontSize="small" />
              </Stack>
            </Stack>
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

function PluginStatusSummary({ plugin }: { plugin: PluginView }) {
  const configurationRequired = requiresPluginConfiguration(plugin);
  const ready = plugin.healthStatus === "READY";
  const failed = !configurationRequired && plugin.healthStatus === "ERROR";
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
          label={
            configurationRequired
              ? "待配置"
              : ready
                ? "环境正常"
                : failed
                  ? "环境异常"
                  : "等待检测"
          }
          color={
            configurationRequired
              ? "warning"
              : ready
                ? "success"
                : failed
                  ? "error"
                  : "warning"
          }
        />
      </Stack>
      <Typography variant="body2" color="text.secondary">
        {configurationRequired
          ? "请先填写并保存插件必填配置。"
          : plugin.lastError ||
            (plugin.lastCheckedAt
              ? `最后检测：${formatDate(plugin.lastCheckedAt)}`
              : "插件版本变化后需要重新检测，检测通过前不会执行任务。")}
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
