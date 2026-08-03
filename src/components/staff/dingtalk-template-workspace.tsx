"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Box, CircularProgress, Stack } from "@mui/material";
import { DingTalkTemplateSettings } from "@/components/staff/dingtalk-template-settings";
import { useToast } from "@/components/shared/toast-provider";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";
import type {
  DingTalkRobotConfig,
  DingTalkRobotEventType,
  DingTalkRobotTemplate,
} from "@achord/plugin-dingtalk-robot/config";
import { queryKeys } from "@/lib/query-keys";

type PluginState = {
  enabled: boolean;
  healthStatus: string;
  config: Record<string, unknown>;
  configuredSecretKeys: string[];
  secretConfigState: string;
};

export function DingTalkTemplateWorkspace() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const pluginQuery = useQuery({
    queryKey: queryKeys.plugins.dingtalk,
    queryFn: ({ signal }) =>
      staffApi<PluginState>("/api/v1/admin/plugins/dingtalk-robot", {
        signal,
      }),
  });
  const saveMutation = useMutation({
    mutationFn: (config: DingTalkRobotConfig) =>
      staffApi<PluginState>(
        "/api/v1/admin/plugins/dingtalk-robot",
        jsonRequest("PATCH", { config }),
      ),
    onSuccess: (plugin) => {
      queryClient.setQueryData(queryKeys.plugins.dingtalk, plugin);
      toast.success("钉钉模板已保存");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "保存失败");
    },
  });
  const testMutation = useMutation({
    mutationFn: ({
      eventType,
      template,
    }: {
      eventType: DingTalkRobotEventType;
      template: DingTalkRobotTemplate;
    }) =>
      staffApi(
        "/api/v1/admin/plugins/dingtalk-robot/test-message",
        jsonRequest("POST", { eventType, template }),
      ),
    onSuccess: () => toast.success("测试消息已发送"),
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "发送失败");
    },
  });
  const plugin = pluginQuery.data;

  async function handleSave(config: DingTalkRobotConfig) {
    try {
      await saveMutation.mutateAsync(config);
      return true;
    } catch {
      return false;
    }
  }

  async function handleTest(
    eventType: DingTalkRobotEventType,
    template: DingTalkRobotTemplate,
  ) {
    await testMutation
      .mutateAsync({ eventType, template })
      .catch(() => undefined);
  }

  if (pluginQuery.isPending) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!plugin || !plugin.enabled) {
    return (
      <Alert severity="info">
        钉钉机器人插件未启用。请先在「插件中心」启用并完成 Webhook 配置。
      </Alert>
    );
  }

  return (
    <Stack spacing={2}>
      {pluginQuery.isError ? (
        <Alert severity="warning">
          插件配置刷新失败，当前显示最近一次已确认的数据。
        </Alert>
      ) : null}
      <DingTalkTemplateSettings
        config={plugin.config}
        busy={saveMutation.isPending || testMutation.isPending}
        canTest={plugin.secretConfigState === "VALID"}
        onSave={handleSave}
        onTest={handleTest}
      />
    </Stack>
  );
}
