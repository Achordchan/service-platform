"use client";

import { useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import ExpandMoreOutlinedIcon from "@mui/icons-material/ExpandMoreOutlined";
import type { PlatformSettingsView } from "@/components/staff/platform-settings-types";

export function SmtpFallbackSettings({
  settings,
  busy,
  onSave,
  onUseLocalOutbox,
}: {
  settings: PlatformSettingsView;
  busy: boolean;
  onSave: (payload: Record<string, unknown>) => void;
  onUseLocalOutbox: () => void;
}) {
  const [smtpSecure, setSmtpSecure] = useState(settings.smtpSecure);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const smtpPassword = String(form.get("smtpPassword") ?? "");
    const payload: Record<string, unknown> = {
      mailMode: "SMTP",
      smtpHost: String(form.get("smtpHost") ?? "").trim(),
      smtpPort: Number(form.get("smtpPort")),
      smtpUser: String(form.get("smtpUser") ?? "").trim(),
      smtpFrom: String(form.get("smtpFrom") ?? "").trim(),
      smtpSecure,
    };
    if (smtpPassword) payload.smtpPassword = smtpPassword;
    onSave(payload);
  }

  return (
    <Accordion
      disableGutters
      elevation={0}
      sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1 }}
    >
      <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
        <Box>
          <Typography sx={{ fontWeight: 700 }}>高级备用方式</Typography>
          <Typography variant="body2" color="text.secondary">
            保留 SMTP 和本地发件箱，用于故障切换
          </Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        <Stack
          key={`smtp-${settings.updatedAt ?? "initial"}`}
          component="form"
          spacing={2}
          onSubmit={handleSubmit}
        >
          <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
            <TextField
              name="smtpHost"
              label="SMTP 主机"
              defaultValue={settings.smtpHost ?? ""}
              fullWidth
              required
            />
            <TextField
              name="smtpPort"
              label="SMTP 端口"
              type="number"
              defaultValue={settings.smtpPort ?? 465}
              fullWidth
              required
            />
          </Stack>
          <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
            <TextField
              name="smtpUser"
              label="SMTP 用户名"
              defaultValue={settings.smtpUser ?? ""}
              fullWidth
              required
            />
            <TextField
              name="smtpPassword"
              label="SMTP 密码"
              type="password"
              fullWidth
              required={!settings.hasStoredPassword}
              helperText={
                settings.hasStoredPassword
                  ? "已保存；留空表示不修改"
                  : "邮箱密码或 SMTP 专用密码"
              }
            />
          </Stack>
          <TextField
            name="smtpFrom"
            label="SMTP 发件人"
            defaultValue={settings.smtpFrom}
            fullWidth
            required
          />
          <FormControlLabel
            control={
              <Switch
                checked={smtpSecure}
                onChange={(event) => setSmtpSecure(event.target.checked)}
              />
            }
            label="使用 SSL/TLS"
          />
          <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
            <Button
              type="button"
              onClick={onUseLocalOutbox}
              disabled={busy || settings.mailMode === "LOCAL_OUTBOX"}
            >
              使用本地发件箱
            </Button>
            <Button type="submit" variant="outlined" disabled={busy}>
              保存并启用 SMTP
            </Button>
          </Stack>
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}
