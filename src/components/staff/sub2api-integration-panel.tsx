"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Avatar,
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
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
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
import { jsonRequest, staffApi } from "@/components/staff/staff-api";

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

type ExternalContact = {
  id: string;
  externalUserId: string;
  email: string | null;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  profileAttributes: Record<string, string | number | boolean>;
  sourceKey: string;
  sourceLabel: string;
  status: "ACTIVE" | "BLOCKED";
  firstSeenAt: string;
  lastSeenAt: string;
  _count: { requestsCreated: number };
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
  const [view, setView] = useState<IntegrationView | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      setView(await staffApi(`/api/v1/projects/${projectId}/integrations/sub2api`));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "连接信息加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    staffApi<IntegrationView>(
      `/api/v1/projects/${projectId}/integrations/sub2api`,
    )
      .then((next) => {
        if (active) setView(next);
      })
      .catch((loadError) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "连接信息加载失败",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  async function check() {
    setWorking(true);
    setError("");
    try {
      await staffApi(
        `/api/v1/projects/${projectId}/integrations/sub2api/check`,
        jsonRequest("POST"),
      );
      await load();
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : "连接检测失败");
      await load();
    } finally {
      setWorking(false);
    }
  }

  async function changeStatus(status: "ACTIVE" | "DISABLED") {
    setWorking(true);
    setError("");
    try {
      await staffApi(
        `/api/v1/projects/${projectId}/integrations/sub2api`,
        jsonRequest("PATCH", { status }),
      );
      await load();
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "状态更新失败");
    } finally {
      setWorking(false);
    }
  }

  async function archive() {
    if (!window.confirm("归档后现有嵌入会话会立即失效，确定继续吗？")) return;
    setWorking(true);
    try {
      await staffApi(
        `/api/v1/projects/${projectId}/integrations/sub2api/archive`,
        jsonRequest("POST"),
      );
      await load();
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "归档失败");
    } finally {
      setWorking(false);
    }
  }

  if (loading) return <LinearProgress />;
  if (!view) return <Alert severity="error">{error || "连接信息不可用"}</Alert>;
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
      {error ? <Alert severity="error">{error}</Alert> : null}
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
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        projectId={projectId}
        connection={connection}
        onSaved={async () => {
          setDialogOpen(false);
          await load();
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
  onSaved: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      await staffApi(
        `/api/v1/projects/${projectId}/integrations/sub2api`,
        jsonRequest(connection ? "PATCH" : "POST", {
          baseUrl: String(data.get("baseUrl") ?? "").trim(),
          adminApiKey: String(data.get("adminApiKey") ?? "").trim() || undefined,
          clearAdminApiKey: data.get("clearAdminApiKey") === "on",
          emailNotificationsEnabled: data.get("emailNotificationsEnabled") === "on",
          customerMemberNotificationsEnabled:
            data.get("customerMemberNotificationsEnabled") === "on",
        }),
      );
      await onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="sm">
      <Box component="form" onSubmit={submit}>
        {saving ? <LinearProgress /> : null}
        <DialogTitle>连接设置</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            <TextField
              name="baseUrl"
              label="Sub2API 地址"
              defaultValue={connection?.baseUrl ?? ""}
              placeholder="https://sub2api.example.com"
              required
              fullWidth
            />
            <TextField
              name="adminApiKey"
              label="管理员 API Key（可选）"
              type="password"
              autoComplete="new-password"
              helperText={connection?.hasAdminApiKey ? "留空表示不修改" : "仅用于补充用户资料"}
              fullWidth
            />
            {connection?.hasAdminApiKey ? (
              <FormControlLabel control={<Switch name="clearAdminApiKey" />} label="清除已保存的管理员 Key" />
            ) : null}
            <FormControlLabel
              control={<Switch name="emailNotificationsEnabled" defaultChecked={connection?.emailNotificationsEnabled ?? true} />}
              label="向外部联系人发送邮件提醒"
            />
            <FormControlLabel
              control={<Switch name="customerMemberNotificationsEnabled" defaultChecked={connection?.customerMemberNotificationsEnabled ?? false} />}
              label="通知客户空间成员"
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
  const [contacts, setContacts] = useState<ExternalContact[]>([]);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<"ALL" | "ACTIVE" | "BLOCKED">("ALL");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [detailContact, setDetailContact] = useState<ExternalContact | null>(null);
  const requestSequence = useRef(0);
  const load = useCallback(async (
    cursor: string | null = null,
    append = false,
  ) => {
    const sequence = ++requestSequence.current;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (keyword.trim()) params.set("q", keyword.trim());
      if (status !== "ALL") params.set("status", status);
      if (cursor) params.set("cursor", cursor);
      const page = await staffApi<ExternalContactPage>(
        `/api/v1/projects/${projectId}/external-contacts?${params}`,
      );
      if (sequence !== requestSequence.current) return;
      setContacts((current) => append ? [...current, ...page.items] : page.items);
      setNextCursor(page.nextCursor);
    } catch (loadError) {
      if (sequence !== requestSequence.current) return;
      setError(loadError instanceof Error ? loadError.message : "联系人加载失败");
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [keyword, projectId, status]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load]);
  async function toggle(contact: ExternalContact) {
    try {
      await staffApi(
        `/api/v1/projects/${projectId}/external-contacts/${contact.id}`,
        jsonRequest("PATCH", { status: contact.status === "ACTIVE" ? "BLOCKED" : "ACTIVE" }),
      );
      await load();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "联系人状态更新失败");
    }
  }
  if (loading) return <LinearProgress />;
  return (
    <Stack spacing={2}>
      {error ? <Alert severity="error">{error}</Alert> : null}
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
      <TableContainer component={Paper} variant="outlined" sx={{ overflowX: "auto" }}>
        <Table size="small" sx={{ minWidth: 900 }}>
          <TableHead>
            <TableRow>
              <TableCell>联系人</TableCell>
              <TableCell>来源</TableCell>
              <TableCell>外部用户 ID</TableCell>
              <TableCell>邮箱 / 用户名</TableCell>
              <TableCell align="right">工单</TableCell>
              <TableCell>最后访问</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {contacts.map((contact) => (
              <TableRow key={contact.id} hover>
                <TableCell>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <Avatar src={contact.avatarUrl ?? undefined} sx={{ width: 28, height: 28 }}>
                      {contact.displayName.slice(0, 1)}
                    </Avatar>
                    <Typography variant="body2">{contact.displayName}</Typography>
                    <Chip size="small" label={contact.status === "ACTIVE" ? "正常" : "已停用"} color={contact.status === "ACTIVE" ? "success" : "default"} />
                  </Stack>
                </TableCell>
                <TableCell>
                  <Chip size="small" label={contact.sourceLabel} variant="outlined" />
                </TableCell>
                <TableCell>{contact.externalUserId}</TableCell>
                <TableCell>{contact.email || contact.username || "未提供"}</TableCell>
                <TableCell align="right">{contact._count.requestsCreated}</TableCell>
                <TableCell>{new Date(contact.lastSeenAt).toLocaleString("zh-CN")}</TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={0.5} sx={{ justifyContent: "flex-end" }}>
                    <Button size="small" onClick={() => setDetailContact(contact)}>查看资料</Button>
                    <Button size="small" color={contact.status === "ACTIVE" ? "inherit" : "primary"} onClick={() => toggle(contact)}>
                      {contact.status === "ACTIVE" ? "停用" : "恢复"}
                    </Button>
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {contacts.length === 0 ? <Alert severity="info">暂无外部联系人。</Alert> : null}
      {nextCursor ? (
        <Button
          variant="outlined"
          onClick={() => void load(nextCursor, true)}
          disabled={loadingMore}
          sx={{ alignSelf: "center" }}
        >
          {loadingMore ? "加载中" : "加载更多"}
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
