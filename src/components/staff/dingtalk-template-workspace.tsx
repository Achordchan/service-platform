"use client";

import { useEffect, useState } from "react";
import { Alert, Box, CircularProgress, Stack } from "@mui/material";
import { DingTalkTemplateSettings } from "@/components/staff/dingtalk-template-settings";
import { useToast } from "@/components/shared/toast-provider";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";
import type {
  DingTalkRobotConfig,
  DingTalkRobotEventType,
  DingTalkRobotTemplate,
} from "@achord/plugin-dingtalk-robot/config";

type PluginState = {
  enabled: boolean;
  healthStatus: string;
  config: Record<string, unknown>;
  configuredSecretKeys: string[];
  secretConfigState: string;
};

export function DingTalkTemplateWorkspace() {
  const toast = useToast();
  const [plugin, setPlugin] = useState<PluginState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    staffApi<PluginState>("/api/v1/admin/plugins/dingtalk-robot")
      .then(setPlugin)
      .catch(() => setPlugin(null))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(config: DingTalkRobotConfig) {
    try {
      const result = await staffApi<PluginState>(
        "/api/v1/admin/plugins/dingtalk-robot",
        jsonRequest("PATCH", { config }),
      );
      setPlugin(result);
      toast.success("钉钉模板已保存");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
      return false;
    }
  }

  async function handleTest(
    eventType: DingTalkRobotEventType,
    template: DingTalkRobotTemplate,
  ) {
    try {
      await staffApi(
        "/api/v1/admin/plugins/dingtalk-robot/test-message",
        jsonRequest("POST", { eventType, template }),
      );
      toast.success("测试消息已发送");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "发送失败");
    }
  }

  if (loading) {
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
      <DingTalkTemplateSettings
        config={plugin.config}
        busy={false}
        canTest={plugin.secretConfigState === "VALID"}
        onSave={handleSave}
        onTest={handleTest}
      />
    </Stack>
  );
}
