"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import ArchiveOutlinedIcon from "@mui/icons-material/ArchiveOutlined";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";
import { useToast } from "@/components/shared/toast-provider";
import { queryKeys } from "@/lib/query-keys";
import {
  UniversalIntegrationGuideDialog,
  type UniversalGuideStage,
} from "@/components/staff/universal-integration-guide-dialog";
import {
  profileFieldsValid,
  UniversalProfileFieldsEditor,
  type ProfileField,
} from "@/components/staff/universal-profile-fields-editor";

type CredentialView = {
  id: string;
  clientId: string;
  secretPrefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

type RecentSessionView = {
  id: string;
  contactId: string;
  contactName: string;
  externalUserId: string;
  launchMode: "iframe" | "native";
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
  status: "ACTIVE" | "EXPIRED" | "REVOKED";
};

type ConnectionView = {
  bindingId: string;
  publicId: string;
  bindingStatus: "DRAFT" | "ACTIVE" | "DISABLED" | "ARCHIVED";
  name: string;
  allowedOrigins: string[];
  allowNativeLaunch: boolean;
  profileFields: ProfileField[];
  emailNotificationsEnabled: boolean;
  customerMemberNotificationsEnabled: boolean;
  webhookUrl: string | null;
  webhookEvents: WebhookEventType[];
  hasWebhookSecret: boolean;
  webhookStatus: string;
  healthStatus: string;
  lastCheckedAt: string | null;
  lastError: string | null;
  embedUrl: string;
  activeCredentialCount: number;
  credentials: CredentialView[];
  recentSessions?: RecentSessionView[];
};

const launchModeLabels: Record<RecentSessionView["launchMode"], string> = {
  iframe: "iframe",
  native: "Native",
};

const sessionStatusLabels: Record<RecentSessionView["status"], string> = {
  ACTIVE: "",
  EXPIRED: " · 已过期",
  REVOKED: " · 已撤销",
};

function formatSessionTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type WebhookEventType =
  | "request.created"
  | "request.public_message.created"
  | "request.status.changed"
  | "request.unread.changed";

const webhookEventOptions: Array<{
  value: WebhookEventType;
  label: string;
}> = [
  { value: "request.created", label: "服务请求创建" },
  { value: "request.public_message.created", label: "公开回复" },
  { value: "request.status.changed", label: "状态变化" },
  { value: "request.unread.changed", label: "未读数量变化" },
];

type IntegrationView = {
  plugin: {
    enabled: boolean;
    healthStatus: string;
    lastError: string | null;
  } | null;
  project: { id: string; title: string };
  connection: ConnectionView | null;
};

type DeliveryView = {
  id: string;
  eventType: string;
  status: "PENDING" | "PROCESSING" | "DELIVERED" | "FAILED";
  attemptCount: number;
  responseStatus: number | null;
  lastError: string | null;
  createdAt: string;
};

type ConnectionDraft = {
  name: string;
  origins: string;
  allowNativeLaunch: boolean;
  profileFields: ProfileField[];
  webhookUrl: string;
  webhookEvents: WebhookEventType[];
  emailNotifications: boolean;
  customerNotifications: boolean;
};

const steps = ["连接配置", "接入凭据", "Webhook", "检测并激活"];

const sectionSx = { p: { xs: 2, md: 2.5 } } as const;

function splitOrigins(origins: string) {
  return origins
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

// 与服务端 connectionCriticalChanged 对应：这几项变了，保存后连接会停用、要重新检测
function criticalSignature(draft: ConnectionDraft) {
  return JSON.stringify([
    [...splitOrigins(draft.origins)].sort(),
    draft.allowNativeLaunch,
    draft.profileFields.map((field) => [
      field.key.trim(),
      field.label.trim(),
      field.type,
    ]),
  ]);
}

function draftSignature(draft: ConnectionDraft) {
  return JSON.stringify([
    criticalSignature(draft),
    draft.name.trim(),
    draft.webhookUrl.trim(),
    [...draft.webhookEvents].sort(),
    draft.emailNotifications,
    draft.customerNotifications,
  ]);
}

function connectionDraftFrom(
  connection: ConnectionView | null | undefined,
  fallbackName?: string,
): ConnectionDraft {
  return {
    name: connection?.name ?? fallbackName ?? "",
    origins: connection?.allowedOrigins.join("\n") ?? "",
    allowNativeLaunch: connection?.allowNativeLaunch ?? false,
    profileFields: connection?.profileFields ?? [],
    webhookUrl: connection?.webhookUrl ?? "",
    webhookEvents:
      connection?.webhookEvents ?? webhookEventOptions.map((item) => item.value),
    emailNotifications: connection?.emailNotificationsEnabled ?? true,
    customerNotifications:
      connection?.customerMemberNotificationsEnabled ?? false,
  };
}

export function UniversalIntegrationPanel({
  projectId,
  canEdit,
}: {
  projectId: string;
  canEdit: boolean;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ConnectionDraft | null>(null);
  const [secret, setSecret] = useState<{
    title: string;
    clientId?: string;
    value: string;
  } | null>(null);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const integrationKey = queryKeys.universal.integration(projectId);
  const integrationQuery = useQuery({
    queryKey: integrationKey,
    queryFn: ({ signal }) =>
      staffApi<IntegrationView>(
        `/api/v1/projects/${projectId}/integrations/universal`,
        { signal },
      ),
  });
  const deliveriesQuery = useQuery({
    queryKey: queryKeys.universal.deliveries(projectId),
    queryFn: ({ signal }) =>
      staffApi<DeliveryView[]>(
        `/api/v1/projects/${projectId}/integrations/universal/webhook-deliveries`,
        { signal },
      ),
    enabled: deliveryOpen && Boolean(integrationQuery.data?.connection),
  });
  const actionMutation = useMutation({
    mutationFn: (action: () => Promise<void>) => action(),
  });
  const view = integrationQuery.data;
  const deliveries = deliveriesQuery.data ?? [];
  const busy = actionMutation.isPending;
  const draftValues =
    draft ?? connectionDraftFrom(view?.connection, view?.project.title);
  const {
    name,
    origins,
    allowNativeLaunch,
    profileFields,
    webhookUrl,
    webhookEvents,
    emailNotifications,
    customerNotifications,
  } = draftValues;

  function updateDraft(
    updater: (current: ConnectionDraft) => ConnectionDraft,
  ) {
    setDraft((current) =>
      updater(
        current ?? connectionDraftFrom(view?.connection, view?.project.title),
      ),
    );
  }

  function invalidateIntegration() {
    void queryClient.invalidateQueries({ queryKey: integrationKey });
  }

  function replaceCachedConnection(connection: ConnectionView) {
    setDraft(null);
    queryClient.setQueryData<IntegrationView>(integrationKey, (current) =>
      current
        ? {
            ...current,
            connection: {
              ...connection,
              recentSessions:
                connection.recentSessions ?? current.connection?.recentSessions,
            },
          }
        : current,
    );
    invalidateIntegration();
  }

  function updateCachedConnection(
    updater: (connection: ConnectionView) => ConnectionView,
  ) {
    queryClient.setQueryData<IntegrationView>(integrationKey, (current) =>
      current?.connection
        ? { ...current, connection: updater(current.connection) }
        : current,
    );
    invalidateIntegration();
  }

  async function runAction(action: () => Promise<void>, fallbackError: string) {
    try {
      await actionMutation.mutateAsync(action);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : fallbackError);
    }
  }

  const visibleCredentials = useMemo(
    () => view?.connection?.credentials.filter((item) => !item.revokedAt) ?? [],
    [view],
  );
  const activeCredentialCount =
    view?.connection?.activeCredentialCount ?? visibleCredentials.length;
  const connectionArchived = view?.connection?.bindingStatus === "ARCHIVED";
  const canModify = canEdit && !connectionArchived;
  const activeStep = !view?.connection
    ? 0
    : activeCredentialCount === 0
      ? 1
      : view.connection.healthStatus !== "READY" ||
          view.connection.bindingStatus !== "ACTIVE"
        ? 3
        : 4;
  const guideStage: UniversalGuideStage = !view?.connection
    ? "CONFIGURE"
    : activeCredentialCount === 0
      ? "CREDENTIALS"
      : activeStep === 4
        ? "ACTIVE"
        : "ACTIVATE";
  const savedDraft = connectionDraftFrom(view?.connection, view?.project.title);
  const dirty =
    draft !== null && draftSignature(draft) !== draftSignature(savedDraft);
  const criticalDirty =
    dirty && criticalSignature(draftValues) !== criticalSignature(savedDraft);
  const fieldsValid = profileFieldsValid(profileFields);
  const platformOrigin = view?.connection?.embedUrl
    ? new URL(view.connection.embedUrl).origin
    : typeof window === "undefined"
      ? ""
      : window.location.origin;

  function connectionPayload(options?: {
    rotateWebhookSecret?: boolean;
    activate?: boolean;
  }) {
    return {
      name: name.trim(),
      allowedOrigins: splitOrigins(origins),
      allowNativeLaunch,
      profileFields,
      emailNotificationsEnabled: emailNotifications,
      customerMemberNotificationsEnabled: customerNotifications,
      webhookUrl: webhookUrl.trim() || null,
      webhookEvents,
      rotateWebhookSecret: options?.rotateWebhookSecret,
      activate: options?.activate,
    };
  }

  async function saveConfiguration(options?: {
    rotateWebhookSecret?: boolean;
    activate?: boolean;
  }) {
    await runAction(async () => {
      const result = await staffApi<{
        connection: ConnectionView;
        webhookSecret: string | null;
      }>(
        `/api/v1/projects/${projectId}/integrations/universal`,
        jsonRequest("PUT", connectionPayload(options)),
      );
      if (result.webhookSecret) {
        setSecret({ title: "Webhook 签名密钥", value: result.webhookSecret });
      }
      replaceCachedConnection(result.connection);
      toast.success(options?.activate ? "连接已激活" : "配置已保存");
    }, "配置保存失败");
  }

  async function createCredential() {
    await runAction(async () => {
      const created = await staffApi<{
        id: string;
        clientId: string;
        clientSecret: string;
        secretPrefix: string;
        createdAt: string;
      }>(
        `/api/v1/projects/${projectId}/integrations/universal/credentials`,
        { method: "POST" },
      );
      setSecret({
        title: "Achord Connect 凭据",
        clientId: created.clientId,
        value: created.clientSecret,
      });
      updateCachedConnection((connection) => ({
        ...connection,
        activeCredentialCount: connection.activeCredentialCount + 1,
        credentials: [
          ...connection.credentials,
          {
            id: created.id,
            clientId: created.clientId,
            secretPrefix: created.secretPrefix,
            lastUsedAt: null,
            revokedAt: null,
            createdAt: created.createdAt,
          },
        ],
      }));
      toast.success("接入凭据已生成");
    }, "凭据生成失败");
  }

  async function revokeCredential(credentialId: string) {
    await runAction(async () => {
      await staffApi(
        `/api/v1/projects/${projectId}/integrations/universal/credentials/${credentialId}`,
        { method: "DELETE" },
      );
      const revokedAt = new Date().toISOString();
      updateCachedConnection((connection) => ({
        ...connection,
        activeCredentialCount: Math.max(
          0,
          connection.activeCredentialCount - 1,
        ),
        credentials: connection.credentials.map((credential) =>
          credential.id === credentialId
            ? { ...credential, revokedAt }
            : credential,
        ),
      }));
      toast.success("接入凭据已撤销");
    }, "凭据撤销失败");
  }

  async function checkConnection() {
    await runAction(async () => {
      try {
        const connection = await staffApi<ConnectionView>(
          `/api/v1/projects/${projectId}/integrations/universal/check`,
          { method: "POST" },
        );
        replaceCachedConnection(connection);
        toast.success("连接检测通过");
      } catch (error) {
        invalidateIntegration();
        throw error;
      }
    }, "连接检测失败");
  }

  async function testWebhook() {
    await runAction(async () => {
      await staffApi(
        `/api/v1/projects/${projectId}/integrations/universal/webhook/test`,
        { method: "POST" },
      );
      toast.success("Webhook 测试已加入投递队列");
      await queryClient.invalidateQueries({
        queryKey: queryKeys.universal.deliveries(projectId),
      });
    }, "Webhook 测试失败");
  }

  async function retryDelivery(deliveryId: string) {
    await runAction(async () => {
      await staffApi(
        `/api/v1/projects/${projectId}/integrations/universal/webhook-deliveries/${deliveryId}/retry`,
        { method: "POST" },
      );
      await queryClient.invalidateQueries({
        queryKey: queryKeys.universal.deliveries(projectId),
      });
      toast.success("Webhook 已重新加入投递队列");
    }, "重新投递失败");
  }

  async function archiveConnection() {
    await runAction(async () => {
      await staffApi(
        `/api/v1/projects/${projectId}/integrations/universal/archive`,
        { method: "POST" },
      );
      setArchiveOpen(false);
      const archivedAt = new Date().toISOString();
      updateCachedConnection((connection) => ({
        ...connection,
        bindingStatus: "ARCHIVED",
        activeCredentialCount: 0,
        credentials: connection.credentials.map((credential) => ({
          ...credential,
          revokedAt: credential.revokedAt ?? archivedAt,
        })),
      }));
      toast.success("连接已归档，现有凭据、票据和嵌入会话已失效");
    }, "连接归档失败");
  }

  if (integrationQuery.isPending) return <LinearProgress />;
  if (!view) {
    return (
      <Alert severity="error">
        {integrationQuery.error instanceof Error
          ? integrationQuery.error.message
          : "连接信息加载失败"}
      </Alert>
    );
  }
  if (!view?.plugin?.enabled || view.plugin.healthStatus !== "READY") {
    return (
      <Stack spacing={2}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
        >
          <Typography variant="h3">Achord Connect</Typography>
          <Button
            variant="outlined"
            size="small"
            startIcon={<MenuBookOutlinedIcon />}
            onClick={() => setGuideOpen(true)}
            sx={{ alignSelf: { xs: "flex-start", sm: "auto" } }}
          >
            接入指南
          </Button>
        </Stack>
        <Alert severity="warning">
          通用服务请求连接器尚未在插件中心完成检测并启用。
        </Alert>
        <UniversalIntegrationGuideDialog
          open={guideOpen}
          onClose={() => setGuideOpen(false)}
          stage="CONFIGURE"
          platformOrigin={platformOrigin}
        />
      </Stack>
    );
  }

  const connection = view.connection;
  const status: {
    tone: "success" | "warning" | "info" | "error";
    chip: string;
    title: string;
    detail?: string;
  } = connectionArchived
    ? {
        tone: "info",
        chip: "已归档",
        title: "连接已归档",
        detail: "历史服务请求和联系人仍保留，配置、凭据和嵌入入口不可再使用。",
      }
    : !connection
      ? {
          tone: "info",
          chip: "未创建",
          title: "第一步：填写连接配置",
          detail: "填好下方的连接配置后，点底部的「保存配置」创建连接。",
        }
      : dirty
        ? {
            tone: "warning",
            chip: "未保存",
            title: "有未保存的修改",
            detail:
              criticalDirty && connection.bindingStatus === "ACTIVE"
                ? "改动涉及嵌入来源、Native Launch 或资料字段：保存后连接会立即停用并断开所有会话，需要重新检测并激活，期间外部用户无法打开服务请求。"
                : "保存后才能执行连接检测或激活。",
          }
        : activeCredentialCount === 0
          ? {
              tone: "info",
              chip: "待配置",
              title: "下一步：生成接入凭据",
              detail: "在下方「接入凭据」生成 Client ID 和 Secret，配置到对方产品的服务端。",
            }
          : connection.healthStatus !== "READY"
            ? {
                tone: connection.bindingStatus === "DISABLED" ? "error" : "warning",
                chip: connection.bindingStatus === "DISABLED" ? "已停用" : "待检测",
                title:
                  connection.bindingStatus === "DISABLED"
                    ? "连接已停用：需要重新检测并激活"
                    : "下一步：执行连接检测",
                detail: "检测通过后即可激活连接。",
              }
            : connection.bindingStatus !== "ACTIVE"
              ? {
                  tone: "warning",
                  chip: "待激活",
                  title: "检测已通过，可以激活连接",
                  detail: "激活后外部用户才能打开服务请求。",
                }
              : {
                  tone: "success",
                  chip: "已激活",
                  title: "连接运行中",
                  detail: `允许 ${connection.allowedOrigins.length} 个嵌入来源${
                    connection.allowNativeLaunch ? "并允许原生应用启动" : ""
                  }，当前有 ${activeCredentialCount} 个有效凭据。`,
                };
  const canActivate =
    canModify &&
    connection?.healthStatus === "READY" &&
    connection.bindingStatus !== "ACTIVE" &&
    activeCredentialCount > 0;

  return (
    <Stack spacing={2.5}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
      >
        <Typography variant="h3">Achord Connect</Typography>
        <Button
          variant="outlined"
          size="small"
          startIcon={<MenuBookOutlinedIcon />}
          onClick={() => setGuideOpen(true)}
          sx={{ alignSelf: { xs: "flex-start", sm: "auto" } }}
        >
          接入指南
        </Button>
      </Stack>
      {integrationQuery.isError ? (
        <Alert severity="warning">
          连接状态刷新失败，当前显示最近一次已确认的数据。
        </Alert>
      ) : null}

      <Paper variant="outlined" sx={sectionSx}>
        <Stack spacing={1.5}>
          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={1.5}
            sx={{ alignItems: { md: "center" }, justifyContent: "space-between" }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Chip size="small" color={status.tone} label={status.chip} />
                <Typography variant="subtitle1" sx={{ fontWeight: 650 }}>
                  {status.title}
                </Typography>
              </Stack>
              {status.detail ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                  {status.detail}
                </Typography>
              ) : null}
            </Box>
            {connection && canModify ? (
              <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
                <Button
                  variant={canActivate || connection.bindingStatus === "ACTIVE" ? "outlined" : "contained"}
                  onClick={() => void checkConnection()}
                  disabled={busy || dirty || activeCredentialCount === 0}
                >
                  执行连接检测
                </Button>
                {canActivate ? (
                  <Button
                    variant="contained"
                    onClick={() => void saveConfiguration({ activate: true })}
                    disabled={busy || dirty}
                  >
                    激活连接
                  </Button>
                ) : null}
              </Stack>
            ) : null}
          </Stack>
          {busy ? <LinearProgress /> : null}
          {connection?.lastError ? (
            <Alert severity="error">{connection.lastError}</Alert>
          ) : null}
          {!connectionArchived && activeStep < 4 ? (
            <Stepper activeStep={activeStep} alternativeLabel>
              {steps.map((label) => (
                <Step key={label}><StepLabel>{label}</StepLabel></Step>
              ))}
            </Stepper>
          ) : null}
          {connection ? (
            <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary" sx={{ wordBreak: "break-all" }}>
                嵌入地址：{connection.embedUrl}
              </Typography>
              <IconButton
                size="small"
                aria-label="复制嵌入地址"
                onClick={() => {
                  void navigator.clipboard.writeText(connection.embedUrl);
                  toast.success("嵌入地址已复制");
                }}
              >
                <ContentCopyOutlinedIcon fontSize="inherit" />
              </IconButton>
            </Stack>
          ) : null}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={sectionSx}>
        <Stack spacing={2}>
          <Typography variant="h3">连接配置</Typography>
          <TextField
            label="连接名称"
            value={name}
            onChange={(event) =>
              updateDraft((current) => ({
                ...current,
                name: event.target.value,
              }))
            }
            disabled={!canModify || busy}
          />
          <TextField
            label="允许嵌入的 Origin"
            value={origins}
            onChange={(event) =>
              updateDraft((current) => ({
                ...current,
                origins: event.target.value,
              }))
            }
            multiline
            minRows={2}
            helperText="每行一个完整 Origin，例如 https://app.example.com。只做原生 App 接入时可留空"
            disabled={!canModify || busy}
          />
          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={allowNativeLaunch}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      allowNativeLaunch: event.target.checked,
                    }))
                  }
                  disabled={!canModify || busy}
                />
              }
              label="允许原生应用启动（Native Launch）"
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", pl: { xs: 0, sm: 6 } }}>
              用于桌面或移动 App：由 App 后端创建票据，App 在自己的窗口、系统浏览器或 WebView 中顶层打开，不做 iframe 来源校验。
            </Typography>
          </Box>
          <Stack direction={{ xs: "column", md: "row" }} spacing={{ xs: 0, md: 2 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={emailNotifications}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      emailNotifications: event.target.checked,
                    }))
                  }
                  disabled={!canModify || busy}
                />
              }
              label="外部用户邮件通知"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={customerNotifications}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      customerNotifications: event.target.checked,
                    }))
                  }
                  disabled={!canModify || busy}
                />
              }
              label="通知客户空间成员"
            />
          </Stack>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={sectionSx}>
        <UniversalProfileFieldsEditor
          fields={profileFields}
          onChange={(fields) =>
            updateDraft((current) => ({ ...current, profileFields: fields }))
          }
          disabled={busy}
          readOnly={!canModify}
        />
      </Paper>

      {connection ? (
        <Paper variant="outlined" sx={sectionSx}>
          <Stack spacing={1.5}>
            <Stack direction={{ xs: "column", sm: "row" }} sx={{ justifyContent: "space-between", alignItems: { sm: "center" } }}>
              <Typography variant="h3">接入凭据</Typography>
              {canModify && activeCredentialCount < 2 ? (
                <Button startIcon={<KeyOutlinedIcon />} onClick={() => void createCredential()} disabled={busy}>生成凭据</Button>
              ) : null}
            </Stack>
            {connection.credentials.map((credential) => (
              <Stack key={credential.id} direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" sx={{ wordBreak: "break-all" }}>{credential.clientId}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {credential.revokedAt ? "已撤销" : `Secret ${credential.secretPrefix}…`}
                  </Typography>
                </Box>
                {canModify && !credential.revokedAt ? (
                  <Button color="inherit" onClick={() => void revokeCredential(credential.id)} disabled={busy}>撤销</Button>
                ) : null}
              </Stack>
            ))}
            {activeCredentialCount === 0 ? (
              <Alert severity="info">尚未生成有效接入凭据。</Alert>
            ) : !canEdit && connection.credentials.length === 0 ? (
              <Alert severity="success">
                已配置 {activeCredentialCount} 个有效接入凭据，详细信息仅平台管理员可见。
              </Alert>
            ) : null}
          </Stack>
        </Paper>
      ) : null}

      {connection ? (
        <Paper variant="outlined" sx={sectionSx}>
          <Stack spacing={1.5}>
            <Stack direction={{ xs: "column", sm: "row" }} sx={{ justifyContent: "space-between", alignItems: { sm: "center" } }}>
              <Typography variant="h3">Webhook</Typography>
              <Button onClick={() => setDeliveryOpen(true)} disabled={busy}>
                投递历史
              </Button>
            </Stack>
            <TextField
              label="Webhook 地址（可选）"
              value={webhookUrl}
              onChange={(event) =>
                updateDraft((current) => ({
                  ...current,
                  webhookUrl: event.target.value,
                }))
              }
              helperText="地址和订阅事件随底部的「保存配置」一起保存"
              disabled={!canModify || busy}
            />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={0.5} sx={{ flexWrap: "wrap" }}>
              {webhookEventOptions.map((option) => (
                <FormControlLabel
                  key={option.value}
                  control={
                    <Checkbox
                      checked={webhookEvents.includes(option.value)}
                      onChange={(event) =>
                        updateDraft((current) => ({
                          ...current,
                          webhookEvents: event.target.checked
                            ? [...current.webhookEvents, option.value]
                            : current.webhookEvents.filter(
                                (item) => item !== option.value,
                              ),
                        }))
                      }
                      disabled={!canModify || busy || !webhookUrl.trim()}
                    />
                  }
                  label={option.label}
                />
              ))}
            </Stack>
            {canModify && connection.webhookUrl ? (
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1}
                sx={{ alignItems: { xs: "stretch", sm: "center" } }}
              >
                <Button
                  variant="outlined"
                  onClick={() => void saveConfiguration({ rotateWebhookSecret: true })}
                  disabled={busy || dirty}
                >
                  生成或轮换签名密钥
                </Button>
                {connection.hasWebhookSecret ? (
                  <Button variant="outlined" onClick={() => void testWebhook()} disabled={busy || dirty}>
                    发送测试
                  </Button>
                ) : null}
                {dirty ? (
                  <Typography variant="caption" color="text.secondary">
                    先保存修改
                  </Typography>
                ) : null}
              </Stack>
            ) : null}
          </Stack>
        </Paper>
      ) : null}

      {connection?.recentSessions?.length ? (
        <Paper variant="outlined" sx={sectionSx}>
          <Stack spacing={1}>
            <Typography variant="h3">最近会话</Typography>
            {connection.recentSessions.map((session) => (
              <Stack
                key={session.id}
                direction={{ xs: "column", sm: "row" }}
                spacing={1}
                sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
              >
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0 }}>
                  <Chip
                    size="small"
                    variant="outlined"
                    color={session.launchMode === "native" ? "secondary" : "default"}
                    label={launchModeLabels[session.launchMode]}
                  />
                  <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
                    {session.contactName} · {session.externalUserId}
                  </Typography>
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                  {formatSessionTime(session.createdAt)} 进入
                  {sessionStatusLabels[session.status]}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Paper>
      ) : null}

      {connection && canEdit && !connectionArchived ? (
        <Paper variant="outlined" sx={{ ...sectionSx, borderColor: "error.light" }}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1.5}
            sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
          >
            <Box>
              <Typography variant="h3">归档连接</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                所有凭据、票据和嵌入会话立即失效，不能在后台恢复。
              </Typography>
            </Box>
            <Button
              color="error"
              variant="outlined"
              startIcon={<ArchiveOutlinedIcon />}
              onClick={() => setArchiveOpen(true)}
              disabled={busy}
              sx={{ flexShrink: 0 }}
            >
              归档连接
            </Button>
          </Stack>
        </Paper>
      ) : null}

      {canModify && (dirty || !connection) ? (
        <Paper
          elevation={8}
          sx={{
            position: "sticky",
            bottom: 16,
            zIndex: 5,
            px: 2,
            py: 1.5,
            display: "flex",
            flexDirection: { xs: "column", sm: "row" },
            gap: 1.5,
            alignItems: { sm: "center" },
            justifyContent: "space-between",
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {!fieldsValid
              ? "资料字段有未填或不合规的项，改好后才能保存"
              : !connection
              ? "填写完成后保存配置以创建连接"
              : criticalDirty && connection.bindingStatus === "ACTIVE"
                ? "有未保存的修改 · 保存后连接会停用，需要重新检测并激活"
                : "有未保存的修改"}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
            {dirty ? (
              <Button onClick={() => setDraft(null)} disabled={busy}>
                放弃修改
              </Button>
            ) : null}
            <Button
              variant="contained"
              onClick={() => void saveConfiguration()}
              disabled={busy || !fieldsValid}
            >
              保存配置
            </Button>
          </Stack>
        </Paper>
      ) : null}

      <Dialog open={Boolean(secret)} onClose={() => setSecret(null)} fullWidth maxWidth="sm">
        <DialogTitle>{secret?.title}</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>该密钥只显示一次，请立即保存到第三方产品的服务端密钥配置中。</Alert>
          {secret?.clientId ? <TextField label="Client ID" value={secret.clientId} fullWidth slotProps={{ input: { readOnly: true } }} sx={{ mb: 2 }} /> : null}
          <TextField
            label="Secret"
            value={secret?.value ?? ""}
            fullWidth
            slotProps={{
              input: {
                readOnly: true,
                endAdornment: (
                  <IconButton aria-label="复制密钥" onClick={() => void navigator.clipboard.writeText(secret?.value ?? "")}>
                    <ContentCopyOutlinedIcon />
                  </IconButton>
                ),
              },
            }}
          />
        </DialogContent>
        <DialogActions><Button onClick={() => setSecret(null)}>已保存</Button></DialogActions>
      </Dialog>
      <Dialog
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>归档通用连接</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mt: 1 }}>
            归档后所有凭据、未使用票据和嵌入会话立即失效，历史服务请求与联系人不会删除。此操作不能在后台恢复。
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setArchiveOpen(false)} disabled={busy}>
            取消
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => void archiveConnection()}
            disabled={busy}
          >
            确认归档
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={deliveryOpen}
        onClose={() => setDeliveryOpen(false)}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>Webhook 投递历史</DialogTitle>
        <DialogContent>
          <Stack spacing={1.25} sx={{ pt: 1 }}>
            {deliveriesQuery.isPending ? <LinearProgress /> : null}
            {deliveriesQuery.isError ? (
              <Alert severity="error">
                {deliveriesQuery.error instanceof Error
                  ? deliveriesQuery.error.message
                  : "投递记录加载失败"}
              </Alert>
            ) : null}
            {deliveries.map((delivery) => (
              <Box
                key={delivery.id}
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", sm: "minmax(0, 1fr) auto" },
                  gap: 1,
                  py: 1.25,
                  borderBottom: "1px solid",
                  borderColor: "divider",
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 650 }}>
                    {delivery.eventType} · {delivery.status}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    尝试 {delivery.attemptCount} 次
                    {delivery.responseStatus ? ` · HTTP ${delivery.responseStatus}` : ""}
                  </Typography>
                  {delivery.lastError ? (
                    <Typography variant="caption" color="error" sx={{ display: "block" }}>
                      {delivery.lastError}
                    </Typography>
                  ) : null}
                </Box>
                {canEdit && delivery.status === "FAILED" ? (
                  <Button
                    size="small"
                    onClick={() => void retryDelivery(delivery.id)}
                    disabled={busy}
                  >
                    重新投递
                  </Button>
                ) : null}
              </Box>
            ))}
            {deliveriesQuery.isSuccess && deliveries.length === 0 ? (
              <Alert severity="info">暂无 Webhook 投递记录。</Alert>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeliveryOpen(false)}>关闭</Button>
        </DialogActions>
      </Dialog>
      <UniversalIntegrationGuideDialog
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        stage={guideStage}
        platformOrigin={platformOrigin}
      />
    </Stack>
  );
}
