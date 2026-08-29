"use client";

import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import PhoneIphoneOutlinedIcon from "@mui/icons-material/PhoneIphoneOutlined";
import ComputerOutlinedIcon from "@mui/icons-material/ComputerOutlined";
import { staffApi } from "@/components/staff/staff-api";

type ClientContext = {
  id: string;
  user: { id: string; name: string; email: string | null };
  client: "WEB" | "MINIAPP";
  online: boolean;
  lastSeenAt: string;
  timezone: string | null;
  ipAddress: string | null;
  ipLocation: string | null;
  device: string | null;
  /** 外部门户联系人（非平台用户）：工单的真正提交者常常是这一类 */
  external: boolean;
};

/**
 * 客户的设备 / 时区 / IP 归属地。
 *
 * 刻意不放在常驻的「客户在线」标识旁：那一行是每次打开工单都会看到的，
 * 塞进这些排查信息既挤又噪。这里做成按需打开的弹窗。
 */
export function CustomerClientContextDialog({
  requestId,
  open,
  onClose,
}: {
  requestId: string;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>客户设备与网络</DialogTitle>
      {/*
        内容体只在打开时挂载，并按 requestId 挂 key：关闭即卸载、重开或换工单即
        全新挂载，天然不会残留上一次的报错或上一位客户的设备与 IP。
        比在 effect 里手动清空更可靠（也不触发 set-state-in-effect）。
      */}
      {open ? (
        <ClientContextBody key={requestId} requestId={requestId} />
      ) : null}
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  );
}

function ClientContextBody({ requestId }: { requestId: string }) {
  const [rows, setRows] = useState<ClientContext[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    staffApi<ClientContext[]>(`/api/v1/requests/${requestId}/client-context`)
      .then((data) => {
        if (!active) return;
        setRows(data);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setRows(null);
        setError(cause instanceof Error ? cause.message : "读取失败");
      });
    return () => {
      active = false;
    };
  }, [requestId]);

  return (
      <DialogContent dividers>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {!rows && !error ? (
          <Stack sx={{ alignItems: "center", py: 4 }}>
            <CircularProgress size={24} />
          </Stack>
        ) : null}
        {rows?.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            客户还没有打开过这个工单，暂无设备记录。
          </Typography>
        ) : null}
        <Stack spacing={2} divider={<Divider flexItem />}>
          {rows?.map((row) => (
            <Stack key={row.id} spacing={0.75}>
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: "center", flexWrap: "wrap" }}
              >
                {row.client === "MINIAPP" ? (
                  <PhoneIphoneOutlinedIcon fontSize="small" color="action" />
                ) : (
                  <ComputerOutlinedIcon fontSize="small" color="action" />
                )}
                <Typography sx={{ fontWeight: 650 }}>
                  {row.user.name}
                </Typography>
                <Chip
                  size="small"
                  label={row.client === "MINIAPP" ? "小程序" : "网页端"}
                  variant="outlined"
                />
                {row.external ? (
                  <Chip size="small" label="外部联系人" variant="outlined" />
                ) : null}
                {row.online ? (
                  <Chip size="small" color="success" label="在线" />
                ) : null}
              </Stack>
              <Field label="设备" value={row.device} />
              <Field label="时区" value={row.timezone} />
              <Field
                label="IP"
                value={
                  row.ipAddress
                    ? row.ipLocation
                      ? `${row.ipAddress}（${row.ipLocation}）`
                      : row.ipAddress
                    : null
                }
              />
              <Field
                label="最近活跃"
                value={new Date(row.lastSeenAt).toLocaleString("zh-CN")}
              />
            </Stack>
          ))}
        </Stack>
      </DialogContent>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ minWidth: 64, flexShrink: 0 }}
      >
        {label}
      </Typography>
      <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
        {value || "未知"}
      </Typography>
    </Stack>
  );
}
