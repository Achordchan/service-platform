"use client";

import {
  Box,
  Button,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import type { PlatformSettingsView } from "@/components/staff/platform-settings-types";

function domainStatusLabel(status: string | null) {
  if (status === "verified") return "已验证";
  if (status === "failed" || status === "partially_failed") return "验证失败";
  if (status === "partially_verified") return "部分验证";
  return "待验证";
}

export function ResendDnsRecords({
  settings,
  busy,
  onVerify,
  onCopy,
}: {
  settings: PlatformSettingsView;
  busy: boolean;
  onVerify: () => void;
  onCopy: (value: string) => void;
}) {
  const domainVerified = settings.resendDomainStatus === "verified";
  const webhookReady =
    settings.resendWebhookStatus === "enabled" &&
    settings.hasResendWebhookSecret;

  return (
    <Stack spacing={2}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        sx={{
          justifyContent: "space-between",
          alignItems: { sm: "center" },
        }}
      >
        <Box>
          <Typography sx={{ fontWeight: 650 }}>
            2. 配置并验证 {settings.resendDomain}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            仅添加下列记录，不修改 achord.cn 主域现有 Email Routing 记录。
          </Typography>
        </Box>
        <Chip
          label={domainStatusLabel(settings.resendDomainStatus)}
          color={domainVerified ? "success" : "warning"}
        />
      </Stack>
      <Box sx={{ overflowX: "auto" }}>
        <Table size="small" sx={{ minWidth: 760 }}>
          <TableHead>
            <TableRow>
              <TableCell>用途</TableCell>
              <TableCell>类型</TableCell>
              <TableCell>名称</TableCell>
              <TableCell>值</TableCell>
              <TableCell>优先级</TableCell>
              <TableCell>状态</TableCell>
              <TableCell>操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {settings.resendDnsRecords.map((record) => (
              <TableRow
                key={`${record.record}-${record.name}-${record.type}`}
              >
                <TableCell>{record.record}</TableCell>
                <TableCell>{record.type}</TableCell>
                <TableCell sx={{ fontFamily: "monospace" }}>
                  {record.name}
                </TableCell>
                <TableCell
                  sx={{
                    fontFamily: "monospace",
                    maxWidth: 320,
                    wordBreak: "break-all",
                  }}
                >
                  {record.value}
                </TableCell>
                <TableCell>{record.priority ?? "—"}</TableCell>
                <TableCell>{record.status}</TableCell>
                <TableCell>
                  <Button size="small" onClick={() => onCopy(record.value)}>
                    复制值
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        sx={{
          justifyContent: "space-between",
          alignItems: { sm: "center" },
        }}
      >
        <Typography variant="body2" color="text.secondary">
          Webhook：{webhookReady ? "已启用" : "未完成"}
          {settings.resendLastCheckedAt
            ? ` · 最后检查 ${new Date(
                settings.resendLastCheckedAt,
              ).toLocaleString("zh-CN")}`
            : ""}
        </Typography>
        <Button variant="outlined" onClick={onVerify} disabled={busy}>
          {busy ? "验证中" : "验证并刷新状态"}
        </Button>
      </Stack>
    </Stack>
  );
}
