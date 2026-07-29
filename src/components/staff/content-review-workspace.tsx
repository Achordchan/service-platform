"use client";

import { useEffect, useState } from "react";
import { Alert, Box, CircularProgress, Stack, Typography } from "@mui/material";
import { ContentRiskPluginSettings } from "@/components/staff/content-risk-plugin-settings";
import { useToast } from "@/components/shared/toast-provider";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";

type PluginState = {
  enabled: boolean;
  healthStatus: string;
  config: Record<string, unknown>;
  configuredSecretKeys: string[];
};

export function ContentReviewWorkspace() {
  const toast = useToast();
  const [plugin, setPlugin] = useState<PluginState | null>(null);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    staffApi<PluginState>("/api/v1/admin/plugins/content-contact-risk")
      .then((result) => {
        setPlugin(result);
        setConfig(result.config);
      })
      .catch(() => setPlugin(null))
      .finally(() => setLoading(false));
  }, []);

  async function saveConfig() {
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { config };
      const secretEntries = Object.entries(secrets).filter(
        ([, value]) => value.trim().length > 0,
      );
      if (secretEntries.length > 0) {
        payload.secrets = Object.fromEntries(secretEntries);
      }
      const result = await staffApi<PluginState>(
        "/api/v1/admin/plugins/content-contact-risk",
        jsonRequest("PATCH", payload),
      );
      setPlugin(result);
      setConfig(result.config);
      setSecrets({});
      toast.success("配置已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!plugin) {
    return (
      <Alert severity="info">
        内容风控插件未安装或无法加载。请在「插件中心」确认插件状态。
      </Alert>
    );
  }

  if (!plugin.enabled && plugin.healthStatus === "UNKNOWN") {
    return (
      <Stack spacing={2}>
        <Alert severity="info">
          内容风控插件已安装但尚未启用。请前往「插件中心」启用后再使用此页面。
        </Alert>
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        监控和处理被风控拦截的内容。配置变更请在「插件中心」操作。
      </Typography>
      <ContentRiskPluginSettings
        enabled={plugin.enabled}
        healthStatus={plugin.healthStatus}
        config={config}
        secrets={secrets}
        hasApiKey={plugin.configuredSecretKeys.includes("apiKey")}
        busy={busy}
        onConfigChange={setConfig}
        onSecretChange={(key, value) =>
          setSecrets((current) => ({ ...current, [key]: value }))
        }
        onSave={saveConfig}
      />
    </Stack>
  );
}
