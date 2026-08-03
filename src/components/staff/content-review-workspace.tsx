"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Alert, Box, CircularProgress, Stack, Typography } from "@mui/material";
import { ContentRiskPluginSettings } from "@/components/staff/content-risk-plugin-settings";
import { staffApi } from "@/components/staff/staff-api";
import { queryKeys } from "@/lib/query-keys";

type PluginState = {
  enabled: boolean;
  healthStatus: string;
  config: Record<string, unknown>;
};

export function ContentReviewWorkspace() {
  const router = useRouter();
  const pluginQuery = useQuery({
    queryKey: queryKeys.contentRisk.plugin,
    queryFn: () =>
      staffApi<PluginState>("/api/v1/admin/plugins/content-contact-risk"),
  });
  const plugin = pluginQuery.data;
  const redirecting = plugin?.enabled === false;

  useEffect(() => {
    if (redirecting) router.replace("/staff/plugins");
  }, [redirecting, router]);

  if (pluginQuery.isPending || redirecting) {
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
      {pluginQuery.isError ? (
        <Alert severity="warning">
          插件状态刷新失败，当前显示最近一次已确认的数据。
        </Alert>
      ) : null}
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
