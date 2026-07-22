"use client";

import { useState } from "react";
import LaunchOutlinedIcon from "@mui/icons-material/LaunchOutlined";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Link,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import {
  SMTP_PROVIDER_GUIDES,
  type SmtpProviderGuide,
} from "@/components/staff/smtp-provider-guides";

export function SmtpProviderGuidesDialog({
  open,
  onClose,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (guide: SmtpProviderGuide) => void;
}) {
  const [selectedKey, setSelectedKey] = useState(
    SMTP_PROVIDER_GUIDES[0]!.key,
  );
  const selected =
    SMTP_PROVIDER_GUIDES.find((guide) => guide.key === selectedKey) ??
    SMTP_PROVIDER_GUIDES[0]!;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" scroll="paper">
      <DialogTitle>常见 SMTP 接入教程</DialogTitle>
      <DialogContent dividers>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "220px minmax(0, 1fr)" },
            gap: { xs: 2, md: 3 },
          }}
        >
          <List disablePadding sx={{ minWidth: 0 }}>
            {SMTP_PROVIDER_GUIDES.map((guide) => (
              <ListItemButton
                key={guide.key}
                selected={guide.key === selected.key}
                onClick={() => setSelectedKey(guide.key)}
                sx={{ px: 1.5, borderRadius: 1 }}
              >
                <ListItemText
                  primary={guide.name}
                  secondary={guide.summary}
                  slotProps={{
                    primary: { sx: { fontWeight: 700 } },
                    secondary: { sx: { mt: 0.35 } },
                  }}
                />
              </ListItemButton>
            ))}
          </List>

          <Stack spacing={2.25} sx={{ minWidth: 0 }}>
            <div>
              <Typography variant="h6">{selected.name}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {selected.summary}
              </Typography>
            </div>
            {selected.warning ? (
              <Alert severity="warning">{selected.warning}</Alert>
            ) : null}
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                gap: 1.5,
              }}
            >
              {[
                ["SMTP 主机", selected.host || "由服务商提供"],
                ["端口", String(selected.port)],
                ["连接加密", selected.secure ? "SSL/TLS" : "STARTTLS"],
                ["用户名", selected.usernameHint],
              ].map(([label, value]) => (
                <Box key={label} sx={{ minWidth: 0 }}>
                  <Typography variant="caption" color="text.secondary">
                    {label}
                  </Typography>
                  <Typography sx={{ overflowWrap: "anywhere" }}>{value}</Typography>
                </Box>
              ))}
            </Box>
            <Divider />
            <div>
              <Typography sx={{ fontWeight: 700 }}>凭据</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {selected.credentialHint}
              </Typography>
            </div>
            <div>
              <Typography sx={{ fontWeight: 700 }}>接入步骤</Typography>
              <Stack component="ol" spacing={1} sx={{ pl: 2.5, mb: 0 }}>
                {selected.steps.map((step) => (
                  <Typography component="li" variant="body2" key={step}>
                    {step}
                  </Typography>
                ))}
              </Stack>
            </div>
            {selected.docsUrl ? (
              <Link
                href={selected.docsUrl}
                target="_blank"
                rel="noreferrer"
                sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
              >
                查看服务商官方说明
                <LaunchOutlinedIcon fontSize="small" />
              </Link>
            ) : null}
          </Stack>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
        <Button
          variant="contained"
          onClick={() => {
            onApply(selected);
            onClose();
          }}
        >
          使用此配置
        </Button>
      </DialogActions>
    </Dialog>
  );
}
