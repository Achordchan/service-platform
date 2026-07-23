import type { PlatformPluginManifest } from "@achord/platform-plugin-sdk";
import {
  DINGTALK_ROBOT_DEFAULT_CONFIG,
  dingTalkRobotBindingField,
  type DingTalkRobotConfig,
} from "./config";

export const DINGTALK_ROBOT_PLUGIN_KEY = "dingtalk-robot";

export const dingTalkRobotManifest: PlatformPluginManifest<DingTalkRobotConfig> = {
  key: DINGTALK_ROBOT_PLUGIN_KEY,
  kind: "UTILITY",
  name: "钉钉机器人通知",
  description: "将新工单和客户回复发送到后台人员使用的钉钉群。",
  version: "1.1.0",
  category: "消息通知",
  minimumPlatformVersion: "0.1.0",
  capabilities: ["network:webhook"],
  defaultConfig: DINGTALK_ROBOT_DEFAULT_CONFIG,
  settings: [dingTalkRobotBindingField],
  actions: [
    {
      key: "send-test-message",
      label: "发送测试消息",
      description: "向当前钉钉群发送一条明确标注的连接测试消息。",
    },
  ],
};
