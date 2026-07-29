"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Box, CircularProgress, Stack, Typography } from "@mui/material";
import { ContentRiskPluginSettings } from "@/components/staff/content-risk-plugin-settings";
import { staffApi } from "@/components/staff/staff-api";

type PluginState = {
  enabled: boolean;
  healthStatus: string;
  config: Record<string, unknown>;
};

export function ContentReviewWorkspace() {
  const router = useRouter();
  const [plugin, setPlugin] = useState<PluginState | null>(null);
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    staffApi<PluginState>("/api/v1/admin/plugins/content-contact-risk")
      .then((result) => {
        if (!result.enabled) {
          setRedirecting(true);
          router.replace("/staff/plugins");
          return;
        }
        setPlugin(result);
      })
      .catch(() => setPlugin(null))
      .finally(() => setLoading(false));
  }, [router]);

  if (loading || redirecting) {
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

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        监控和处理被风控拦截的内容。配置变更请在「插件中心」操作。
      </Typography>
      <ContentRiskPluginSettings
        enabled={plugin.enabled}
        healthStatus={plugin.healthStatus}
        config={plugin.config}
        readOnly
      />
    </Stack>
  );
}
