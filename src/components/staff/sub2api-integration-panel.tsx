"use client";

import { useDeferredValue, useState } from "react";
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import SyncOutlinedIcon from "@mui/icons-material/SyncOutlined";
import ArchiveOutlinedIcon from "@mui/icons-material/ArchiveOutlined";
import BlockOutlinedIcon from "@mui/icons-material/BlockOutlined";
import CheckCircleOutlineOutlinedIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import { useAppConfirm } from "@/components/shared/confirm-provider";
import {
  ExternalContactGrid,
  type ExternalContact,
} from "@/components/staff/external-contact-grid";
import {
  jsonRequest,
  staffApi,
  type ApiRequestOptions,
} from "@/components/staff/staff-api";
import { queryKeys } from "@/lib/query-keys";

const connectionFormSchema = z.object({
  baseUrl: z.url("请输入有效的 Sub2API 地址").max(2048),
  adminApiKey: z.string().trim().max(512),
  clearAdminApiKey: z.boolean(),
  emailNotificationsEnabled: z.boolean(),
  customerMemberNotificationsEnabled: z.boolean(),
});

type ConnectionFormValues = z.infer<typeof connectionFormSchema>;

type Connection = {
  bindingId: string;
  publicId: string;
  bindingStatus: "DRAFT" | "ACTIVE" | "DISABLED" | "ARCHIVED";
  baseUrl: string;
  sourceOrigin: string;
  hasAdminApiKey: boolean;
  emailNotificationsEnabled: boolean;
  customerMemberNotificationsEnabled: boolean;
  healthStatus: string;
  lastCheckedAt: string | null;
  lastError: string | null;
  iframeUrl: string;
};

type IntegrationView = {
  plugin: { enabled: boolean; healthStatus: string; lastError: string | null };
  connection: Connection | null;
};

type ExternalContactPage = {
  items: ExternalContact[];
  nextCursor: string | null;
};

function statusLabel(status: string) {
  return {
    DRAFT: "待激活",
    ACTIVE: "已启用",
    DISABLED: "已停用",
    ARCHIVED: "已归档",
  }[status] ?? status;
}

export function Sub2ApiIntegrationPanel({
  projectId,
  canEdit,
}: {
  projectId: string;
  canEdit: boolean;
}) {
  const confirm = useAppConfirm();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const integrationKey = queryKeys.sub2api.integration(projectId);
  const integrationQuery = useQuery({
    queryKey: integrationKey,
    queryFn: ({ signal }) =>
      staffApi<IntegrationView>(
        `/api/v1/projects/${projectId}/integrations/sub2api`,
        { signal },
      ),
  });
  const actionMutation = useMutation({
    mutationFn: ({
      url,
      init,
    }: {
      kind: "check" | "status" | "archive";
      url: string;
      init: ApiRequestOptions;
    }) => staffApi<Connection | { archived: true }>(url, init),
    onSuccess: (result, variables) => {
      queryClient.setQueryData<IntegrationView>(integrationKey, (current) => {
        if (!current?.connection) return current;
        return {
          ...current,
          connection:
            variables.kind === "archive"
              ? { ...current.connection, bindingStatus: "ARCHIVED" }
              : (result as Connection),
        };
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: integrationKey });
    },
  });
  const view = integrationQuery.data;
  const working = actionMutation.isPending;
  const error = actionMutation.error ?? integrationQuery.error;
  const errorMessage =
    error instanceof Error ? error.message : error ? "连接操作失败" : "";

  async function check() {
    try {
      await actionMutation.mutateAsync({
        kind: "check",
        url: `/api/v1/projects/${projectId}/integrations/sub2api/check`,
        init: jsonRequest("POST"),
      });
    } catch {
      // Mutation state renders the API error and onSettled refreshes the view.
    }
  }

  async function changeStatus(status: "ACTIVE" | "DISABLED") {
    try {
      await actionMutation.mutateAsync({
        kind: "status",
        url: `/api/v1/projects/${projectId}/integrations/sub2api`,
        init: jsonRequest("PATCH", { status }),
      });
    } catch {
      // Mutation state renders the API error.
    }
  }

  async function archive() {
    const confirmed = await confirm({
      title: "归档 Sub2API 连接？",
      description: "归档后现有嵌入会话会立即失效。",
      confirmationText: "确认归档",
      confirmationButtonProps: { color: "error", variant: "contained" },
    });
    if (!confirmed) return;
    try {
      await actionMutation.mutateAsync({
        kind: "archive",
        url: `/api/v1/projects/${projectId}/integrations/sub2api/archive`,
        init: jsonRequest("POST"),
      });
    } catch {
      // Mutation state renders the API error.
    }
  }

  if (integrationQuery.isPending) return <LinearProgress />;
  if (!view) {
    return (
      <Alert severity="error">{errorMessage || "连接信息不可用"}</Alert>
    );
  }
  if (!view.plugin.enabled || view.plugin.healthStatus !== "READY") {
    return (
      <Alert severity="warning">
        Sub2API 连接器尚未在插件中心完成检测并启用。
      </Alert>
    );
  }
  const connection = view.connection;

  return (
    <Stack spacing={2.5}>
      {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          sx={{ justifyContent: "space-between", alignItems: { sm: "center" } }}
        >
          <Box>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Typography variant="h3">Sub2API 连接</Typography>
              {connection ? (
                <Chip
                  size="small"
                  color={connection.bindingStatus === "ACTIVE" ? "success" : "default"}
                  label={statusLabel(connection.bindingStatus)}
                />
              ) : null}
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
              {connection?.baseUrl ?? "尚未配置实例地址"}
            </Typography>
          </Box>
          {canEdit && connection?.bindingStatus !== "ARCHIVED" ? (
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
              <Button startIcon={<SettingsOutlinedIcon />} onClick={() => setDialogOpen(true)}>
                设置
              </Button>
              {connection ? (
                <Button startIcon={<SyncOutlinedIcon />} onClick={check} disabled={working}>
                  检测
                </Button>
              ) : null}
              {connection?.healthStatus === "READY" && connection.bindingStatus !== "ACTIVE" ? (
                <Button
                  variant="contained"
                  startIcon={<CheckCircleOutlineOutlinedIcon />}
                  onClick={() => changeStatus("ACTIVE")}
                  disabled={working}
                >
                  激活
                </Button>
              ) : null}
              {connection?.bindingStatus === "ACTIVE" ? (
                <Button
                  color="inherit"
                  startIcon={<BlockOutlinedIcon />}
                  onClick={() => changeStatus("DISABLED")}
                  disabled={working}
                >
                  停用
                </Button>
              ) : null}
              {connection ? (
                <Tooltip title="归档连接">
                  <IconButton onClick={archive} disabled={working}>
                    <ArchiveOutlinedIcon />
                  </IconButton>
                </Tooltip>
              ) : null}
            </Stack>
          ) : null}
          {canEdit && !connection ? (
            <Button startIcon={<SettingsOutlinedIcon />} onClick={() => setDialogOpen(true)}>
              设置
            </Button>
          ) : null}
        </Stack>

        {connection ? (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "repeat(3, minmax(0, 1fr))" },
              gap: 2.5,
              mt: 3,
            }}
          >
            <Box>
              <Typography variant="body2" color="text.secondary">环境状态</Typography>
              <Typography sx={{ mt: 0.5 }}>
                {connection.healthStatus === "READY" ? "检测通过" : connection.lastError || "待检测"}
              </Typography>
            </Box>
            <Box>
              <Typography variant="body2" color="text.secondary">管理员 Key</Typography>
              <Typography sx={{ mt: 0.5 }}>{connection.hasAdminApiKey ? "已配置" : "未配置"}</Typography>
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" color="text.secondary">iframe 地址</Typography>
              <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", mt: 0.5 }}>
                <Typography variant="body2" noWrap title={connection.iframeUrl} sx={{ minWidth: 0 }}>
                  {connection.iframeUrl}
                </Typography>
                <Tooltip title="复制地址">
                  <IconButton size="small" onClick={() => navigator.clipboard.writeText(connection.iframeUrl)}>
                    <ContentCopyOutlinedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Box>
          </Box>
        ) : null}
      </Paper>
      <ConnectionDialog
        key={`${connection?.bindingId ?? "new"}:${dialogOpen ? "open" : "closed"}`}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        projectId={projectId}
        connection={connection}
        onSaved={(savedConnection) => {
          setDialogOpen(false);
          queryClient.setQueryData<IntegrationView>(integrationKey, (current) =>
            current
              ? { ...current, connection: savedConnection }
              : current,
          );
          void queryClient.invalidateQueries({ queryKey: integrationKey });
        }}
      />
    </Stack>
  );
}

function ConnectionDialog({
  open,
  onClose,
  projectId,
  connection,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  connection: Connection | null;
  onSaved: (connection: Connection) => void;
}) {
  const form = useForm<ConnectionFormValues>({
    resolver: zodResolver(connectionFormSchema),
    defaultValues: {
      baseUrl: connection?.baseUrl ?? "",
      adminApiKey: "",
      clearAdminApiKey: false,
      emailNotificationsEnabled: connection?.emailNotificationsEnabled ?? true,
      customerMemberNotificationsEnabled:
        connection?.customerMemberNotificationsEnabled ?? false,
    },
  });
  const submit = form.handleSubmit(async (values) => {
    form.clearErrors("root");
    try {
      const savedConnection = await staffApi<Connection>(
        `/api/v1/projects/${projectId}/integrations/sub2api`,
        jsonRequest(connection ? "PATCH" : "POST", {
          ...values,
          adminApiKey: values.adminApiKey || undefined,
        }),
      );
      onSaved(savedConnection);
    } catch (saveError) {
      form.setError("root", {
        message: saveError instanceof Error ? saveError.message : "保存失败",
      });
    }
  });
  const saving = form.formState.isSubmitting;
  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="sm">
      <Box component="form" onSubmit={submit}>
        {saving ? <LinearProgress /> : null}
        <DialogTitle>连接设置</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {form.formState.errors.root?.message ? (
              <Alert severity="error">{form.formState.errors.root.message}</Alert>
            ) : null}
            <Controller
              name="baseUrl"
              control={form.control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Sub2API 地址"
                  placeholder="https://sub2api.example.com"
                  required
                  fullWidth
                  error={Boolean(form.formState.errors.baseUrl)}
                  helperText={form.formState.errors.baseUrl?.message}
                />
              )}
            />
            <Controller
              name="adminApiKey"
              control={form.control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="管理员 API Key（可选）"
                  type="password"
                  autoComplete="new-password"
                  error={Boolean(form.formState.errors.adminApiKey)}
                  helperText={
                    form.formState.errors.adminApiKey?.message ??
                    (connection?.hasAdminApiKey
                      ? "留空表示不修改"
                      : "仅用于补充用户资料")
                  }
                  fullWidth
                />
              )}
            />
            {connection?.hasAdminApiKey ? (
              <Controller
                name="clearAdminApiKey"
                control={form.control}
                render={({ field }) => (
                  <FormControlLabel
                    control={
                      <Switch
                        checked={field.value}
                        onChange={(_, checked) => field.onChange(checked)}
                      />
                    }
                    label="清除已保存的管理员 Key"
                  />
                )}
              />
            ) : null}
            <Controller
              name="emailNotificationsEnabled"
              control={form.control}
              render={({ field }) => (
                <FormControlLabel
                  control={
                    <Switch
                      checked={field.value}
                      onChange={(_, checked) => field.onChange(checked)}
                    />
                  }
                  label="向外部联系人发送邮件提醒"
                />
              )}
            />
            <Controller
              name="customerMemberNotificationsEnabled"
              control={form.control}
              render={({ field }) => (
                <FormControlLabel
                  control={
                    <Switch
                      checked={field.value}
                      onChange={(_, checked) => field.onChange(checked)}
                    />
                  }
                  label="通知客户空间成员"
                />
              )}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={onClose} disabled={saving}>取消</Button>
          <Button type="submit" variant="contained" disabled={saving}>保存</Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

export function ExternalContactsPanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<"ALL" | "ACTIVE" | "BLOCKED">("ALL");
  const [detailContact, setDetailContact] = useState<ExternalContact | null>(null);
  const deferredKeyword = useDeferredValue(keyword.trim());
  const contactsQuery = useInfiniteQuery({
    queryKey: queryKeys.sub2api.externalContacts(
      projectId,
      deferredKeyword,
      status,
    ),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: "50" });
      if (deferredKeyword) params.set("q", deferredKeyword);
      if (status !== "ALL") params.set("status", status);
      if (pageParam) params.set("cursor", pageParam);
      return staffApi<ExternalContactPage>(
        `/api/v1/projects/${projectId}/external-contacts?${params}`,
        { signal },
      );
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
  const toggleMutation = useMutation({
    mutationFn: (contact: ExternalContact) =>
      staffApi(
        `/api/v1/projects/${projectId}/external-contacts/${contact.id}`,
        jsonRequest("PATCH", {
          status: contact.status === "ACTIVE" ? "BLOCKED" : "ACTIVE",
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.sub2api.externalContactsRoot(projectId),
      });
    },
  });
  const contacts =
    contactsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const error = toggleMutation.error ?? contactsQuery.error;
  const errorMessage =
    error instanceof Error ? error.message : error ? "联系人操作失败" : "";

  if (contactsQuery.isPending) return <LinearProgress />;
  return (
    <Stack spacing={2}>
      {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
        <TextField
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="搜索姓名、邮箱、用户名或外部 ID"
          sx={{ width: { xs: "100%", sm: 420 } }}
        />
        <TextField
          select
          label="状态"
          value={status}
          onChange={(event) => setStatus(event.target.value as typeof status)}
          sx={{ width: { xs: "100%", sm: 150 } }}
        >
          <MenuItem value="ALL">全部</MenuItem>
          <MenuItem value="ACTIVE">正常</MenuItem>
          <MenuItem value="BLOCKED">已停用</MenuItem>
        </TextField>
      </Stack>
      {contactsQuery.isFetching && !contactsQuery.isFetchingNextPage ? (
        <LinearProgress />
      ) : null}
      <Paper variant="outlined" sx={{ overflow: "hidden" }}>
        <ExternalContactGrid
          rows={contacts}
          actionContactId={
            toggleMutation.isPending ? toggleMutation.variables?.id ?? null : null
          }
          onView={setDetailContact}
          onToggle={toggleMutation.mutate}
        />
      </Paper>
      {contactsQuery.hasNextPage ? (
        <Button
          variant="outlined"
          onClick={() => void contactsQuery.fetchNextPage()}
          disabled={contactsQuery.isFetching}
          sx={{ alignSelf: "center" }}
        >
          {contactsQuery.isFetchingNextPage ? "加载中" : "加载更多"}
        </Button>
      ) : null}
      <Dialog
        open={Boolean(detailContact)}
        onClose={() => setDetailContact(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>外部联系人资料</DialogTitle>
        <DialogContent>
          {detailContact ? (
            <Stack spacing={1.5} sx={{ pt: 1 }}>
              <ContactDetailRow label="来源" value={detailContact.sourceLabel} />
              <ContactDetailRow label="外部用户 ID" value={detailContact.externalUserId} />
              <ContactDetailRow label="显示名称" value={detailContact.displayName} />
              <ContactDetailRow label="邮箱" value={detailContact.email || "未提供"} />
              <ContactDetailRow label="用户名" value={detailContact.username || "未提供"} />
              {Object.entries(detailContact.profileAttributes).map(([key, value]) => (
                <ContactDetailRow key={key} label={key} value={String(value)} />
              ))}
              {Object.keys(detailContact.profileAttributes).length === 0 ? (
                <Alert severity="info">该联系人没有自定义资料。</Alert>
              ) : null}
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailContact(null)}>关闭</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

function ContactDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", sm: "140px minmax(0, 1fr)" },
        gap: 0.5,
      }}
    >
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>{value}</Typography>
    </Box>
  );
}
