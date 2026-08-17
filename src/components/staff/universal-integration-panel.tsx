"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  LinearProgress,
  MenuItem,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import ArchiveOutlinedIcon from "@mui/icons-material/ArchiveOutlined";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";
import { useToast } from "@/components/shared/toast-provider";
import { queryKeys } from "@/lib/query-keys";
import {
  UniversalIntegrationGuideDialog,
  type UniversalGuideStage,
} from "@/components/staff/universal-integration-guide-dialog";

type ProfileField = {
  key: string;
  label: string;
  type: "text" | "number" | "boolean" | "date";
};

type CredentialView = {
  id: string;
  clientId: string;
  secretPrefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

type ConnectionView = {
  bindingId: string;
  publicId: string;
  bindingStatus: "DRAFT" | "ACTIVE" | "DISABLED" | "ARCHIVED";
  name: string;
  allowedOrigins: string[];
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
};

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
  profileFields: ProfileField[];
  webhookUrl: string;
  webhookEvents: WebhookEventType[];
  emailNotifications: boolean;
  customerNotifications: boolean;
};

const steps = ["连接配置", "接入凭据", "Webhook", "检测并激活"];

function connectionDraftFrom(
  connection: ConnectionView | null | undefined,
  fallbackName?: string,
): ConnectionDraft {
  return {
    name: connection?.name ?? fallbackName ?? "",
    origins: connection?.allowedOrigins.join("\n") ?? "",
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
      current ? { ...current, connection } : current,
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
      allowedOrigins: origins
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
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
      {busy ? <LinearProgress /> : null}
      {integrationQuery.isError ? (
        <Alert severity="warning">
          连接状态刷新失败，当前显示最近一次已确认的数据。
        </Alert>
      ) : null}
      {connectionArchived ? (
        <Alert severity="info">
          连接已归档。历史服务请求和联系人仍保留，配置、凭据和嵌入入口不可再使用。
        </Alert>
      ) : activeStep === 4 ? (
        <Alert severity="success">
          Achord Connect 已激活，允许 {view.connection?.allowedOrigins.length ?? 0} 个嵌入来源，当前有 {activeCredentialCount} 个有效凭据。
        </Alert>
      ) : (
        <Stepper activeStep={activeStep} alternativeLabel>
          {steps.map((label) => (
            <Step key={label}><StepLabel>{label}</StepLabel></Step>
          ))}
        </Stepper>
      )}

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
          helperText="每行一个完整 Origin，例如 https://app.example.com"
          disabled={!canModify || busy}
        />
        <Stack spacing={1.25}>
          <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
            <Typography variant="subtitle2">用户自定义资料</Typography>
            {canModify && profileFields.length < 10 ? (
              <Button
                size="small"
                startIcon={<AddOutlinedIcon />}
                onClick={() =>
                  updateDraft((current) => ({
                    ...current,
                    profileFields: [
                      ...current.profileFields,
                      { key: "", label: "", type: "text" },
                    ],
                  }))
                }
              >
                添加字段
              </Button>
            ) : null}
          </Stack>
          {profileFields.map((field, index) => (
            <Box
              key={`${field.key}-${index}`}
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 150px 40px" },
                gap: 1,
                alignItems: "center",
              }}
            >
              <TextField
                label="字段 key"
                value={field.key}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    profileFields: current.profileFields.map(
                      (item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, key: event.target.value }
                          : item,
                    ),
                  }))
                }
                disabled={!canModify || busy}
              />
              <TextField
                label="显示名称"
                value={field.label}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    profileFields: current.profileFields.map(
                      (item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, label: event.target.value }
                          : item,
                    ),
                  }))
                }
                disabled={!canModify || busy}
              />
              <TextField
                select
                label="类型"
                value={field.type}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    profileFields: current.profileFields.map(
                      (item, itemIndex) =>
                        itemIndex === index
                          ? {
                              ...item,
                              type: event.target.value as ProfileField["type"],
                            }
                          : item,
                    ),
                  }))
                }
                disabled={!canModify || busy}
              >
                <MenuItem value="text">文本</MenuItem>
                <MenuItem value="number">数字</MenuItem>
                <MenuItem value="boolean">布尔值</MenuItem>
                <MenuItem value="date">日期</MenuItem>
              </TextField>
              <IconButton
                aria-label="删除资料字段"
                onClick={() =>
                  updateDraft((current) => ({
                    ...current,
                    profileFields: current.profileFields.filter(
                      (_, itemIndex) => itemIndex !== index,
                    ),
                  }))
                }
                disabled={!canModify || busy}
              >
                <DeleteOutlineOutlinedIcon />
              </IconButton>
            </Box>
          ))}
        </Stack>
        <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
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
              />
            }
            label="通知客户空间成员"
          />
        </Stack>
        {canModify ? <Button variant="contained" onClick={() => void saveConfiguration()} disabled={busy} sx={{ alignSelf: "flex-start" }}>保存配置</Button> : null}
      </Stack>

      {view.connection ? (
        <Stack spacing={1.5}>
          <Stack direction={{ xs: "column", sm: "row" }} sx={{ justifyContent: "space-between", alignItems: { sm: "center" } }}>
            <Typography variant="h3">接入凭据</Typography>
            {canModify && activeCredentialCount < 2 ? (
              <Button startIcon={<KeyOutlinedIcon />} onClick={() => void createCredential()} disabled={busy}>生成凭据</Button>
            ) : null}
          </Stack>
          {view.connection.credentials.map((credential) => (
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
          ) : !canEdit && view.connection.credentials.length === 0 ? (
            <Alert severity="success">
              已配置 {activeCredentialCount} 个有效接入凭据，详细信息仅平台管理员可见。
            </Alert>
          ) : null}
        </Stack>
      ) : null}

      {view.connection ? (
        <Stack spacing={1.5}>
          <Typography variant="h3">Webhook</Typography>
          <TextField
            label="Webhook 地址（可选）"
            value={webhookUrl}
            onChange={(event) =>
              updateDraft((current) => ({
                ...current,
                webhookUrl: event.target.value,
              }))
            }
            disabled={!canModify || busy}
          />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={0.5}>
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
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            sx={{ alignItems: { xs: "stretch", sm: "center" } }}
          >
            {canModify ? (
              <>
              <Button onClick={() => void saveConfiguration()} disabled={busy}>保存 Webhook</Button>
              {webhookUrl.trim() ? (
                <Button onClick={() => void saveConfiguration({ rotateWebhookSecret: true })} disabled={busy}>生成或轮换签名密钥</Button>
              ) : null}
              {webhookUrl.trim() && view.connection.hasWebhookSecret ? (
                <Button onClick={() => void testWebhook()} disabled={busy}>发送测试</Button>
              ) : null}
              </>
            ) : null}
            <Button
              onClick={() => setDeliveryOpen(true)}
              disabled={busy}
            >
              投递历史
            </Button>
          </Stack>
        </Stack>
      ) : null}

      {view.connection ? (
        <Stack spacing={1.5}>
          <Typography variant="h3">检测与激活</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-all" }}>
            嵌入地址：{view.connection.embedUrl}
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            {canModify ? <Button variant="outlined" onClick={() => void checkConnection()} disabled={busy}>执行连接检测</Button> : null}
            {canModify && view.connection.healthStatus === "READY" && view.connection.bindingStatus !== "ACTIVE" ? (
              <Button variant="contained" onClick={() => void saveConfiguration({ activate: true })} disabled={busy}>激活连接</Button>
            ) : null}
            {canEdit && !connectionArchived ? (
              <Button
                color="error"
                variant="outlined"
                startIcon={<ArchiveOutlinedIcon />}
                onClick={() => setArchiveOpen(true)}
                disabled={busy}
              >
                归档连接
              </Button>
            ) : null}
          </Stack>
          {view.connection.lastError ? <Alert severity="error">{view.connection.lastError}</Alert> : null}
        </Stack>
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
