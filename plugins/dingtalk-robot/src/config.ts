import { z } from "zod";

export const DINGTALK_ROBOT_KEYWORD = "工单通知";

export const DINGTALK_ROBOT_EVENT_TYPES = [
  "REQUEST_CREATED",
  "REQUEST_CUSTOMER_REPLIED",
] as const;

export type DingTalkRobotEventType =
  (typeof DINGTALK_ROBOT_EVENT_TYPES)[number];

export type DingTalkRobotTemplate = {
  title: string;
  body: string;
};

export type DingTalkRobotConfig = {
  templates: Record<DingTalkRobotEventType, DingTalkRobotTemplate>;
};

export const DINGTALK_ROBOT_TEMPLATE_VARIABLES = [
  { key: "requestNumber", label: "工单编号", sample: "REQ-1001" },
  { key: "requestTitle", label: "工单标题", sample: "无法连接 VPN" },
  { key: "customerName", label: "客户", sample: "示例客户" },
  { key: "projectName", label: "项目", sample: "企业 VPN 服务" },
  { key: "priorityLabel", label: "优先级", sample: "高" },
  { key: "actorName", label: "操作人", sample: "张三" },
  { key: "occurredAt", label: "发生时间", sample: "2026/07/23 10:30" },
] as const;

export const DINGTALK_ROBOT_TEMPLATE_DEFINITIONS = [
  {
    key: "REQUEST_CREATED",
    name: "新建服务请求",
    description: "客户或后台人员创建新工单后发送。",
  },
  {
    key: "REQUEST_CUSTOMER_REPLIED",
    name: "客户公开回复",
    description: "客户或外部联系人公开回复工单后发送。",
  },
] as const;

export const DINGTALK_ROBOT_DEFAULT_CONFIG: DingTalkRobotConfig = {
  templates: {
    REQUEST_CREATED: {
      title: "新工单待处理",
      body: [
        "- **工单**：{{requestNumber}} {{requestTitle}}",
        "- **客户**：{{customerName}}",
        "- **项目**：{{projectName}}",
        "- **优先级**：{{priorityLabel}}",
        "- **提交人**：{{actorName}}",
        "- **时间**：{{occurredAt}}",
      ].join("\n"),
    },
    REQUEST_CUSTOMER_REPLIED: {
      title: "客户有新回复",
      body: [
        "- **工单**：{{requestNumber}} {{requestTitle}}",
        "- **客户**：{{customerName}}",
        "- **项目**：{{projectName}}",
        "- **回复人**：{{actorName}}",
        "- **时间**：{{occurredAt}}",
      ].join("\n"),
    },
  },
};

export type DingTalkRobotBinding = {
  webhookUrl: string;
};

export const dingTalkRobotBindingField = {
  key: "webhookUrl",
  type: "secret-url",
  label: "钉钉机器人 Webhook 地址",
  description: `请粘贴启用了“${DINGTALK_ROBOT_KEYWORD}”自定义关键词的机器人 Webhook 地址。`,
  required: true,
} as const;

export class DingTalkRobotConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DingTalkRobotConfigError";
  }
}

export const dingTalkRobotBindingSchema = z
  .object({ webhookUrl: z.string().trim().min(1) })
  .strict();

const dingTalkRobotTemplateSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    body: z.string().trim().min(1).max(2_000),
  })
  .strict();

const dingTalkRobotConfigSchema = z
  .object({
    templates: z
      .object({
        REQUEST_CREATED: dingTalkRobotTemplateSchema,
        REQUEST_CUSTOMER_REPLIED: dingTalkRobotTemplateSchema,
      })
      .strict()
      .default(DINGTALK_ROBOT_DEFAULT_CONFIG.templates),
  });

export function parseDingTalkRobotBinding(
  value: unknown,
): DingTalkRobotBinding {
  const parsed = dingTalkRobotBindingSchema.safeParse(value);
  if (!parsed.success) {
    throw new DingTalkRobotConfigError("请填写钉钉机器人 Webhook 地址");
  }
  return {
    webhookUrl: validateDingTalkRobotWebhookUrl(parsed.data.webhookUrl),
  };
}

export function parseDingTalkRobotConfig(value: unknown): DingTalkRobotConfig {
  const parsed = dingTalkRobotConfigSchema.safeParse(value);
  if (!parsed.success) {
    throw new DingTalkRobotConfigError("钉钉通知模板配置无效");
  }
  for (const template of Object.values(parsed.data.templates)) {
    validateTemplateVariables(template);
  }
  return parsed.data;
}

export function parseDingTalkRobotTemplate(
  value: unknown,
): DingTalkRobotTemplate {
  const parsed = dingTalkRobotTemplateSchema.safeParse(value);
  if (!parsed.success) {
    throw new DingTalkRobotConfigError("钉钉通知模板格式无效");
  }
  validateTemplateVariables(parsed.data);
  return parsed.data;
}

export function getDingTalkRobotTemplate(
  config: DingTalkRobotConfig,
  eventType: DingTalkRobotEventType,
) {
  return config.templates[eventType];
}

function validateTemplateVariables(template: DingTalkRobotTemplate) {
  const allowedVariables = new Set<string>(
    DINGTALK_ROBOT_TEMPLATE_VARIABLES.map((variable) => variable.key),
  );
  for (const content of [template.title, template.body]) {
    for (const match of content.matchAll(
      /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g,
    )) {
      if (!allowedVariables.has(match[1] ?? "")) {
        throw new DingTalkRobotConfigError(
          `钉钉通知模板包含不支持的变量：${match[1]}`,
        );
      }
    }
  }
}

export function validateDingTalkRobotWebhookUrl(value: string) {
  const candidate = value.trim();
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new DingTalkRobotConfigError("钉钉机器人 Webhook 地址格式无效");
  }

  if (url.protocol !== "https:") {
    throw new DingTalkRobotConfigError("钉钉机器人 Webhook 必须使用 HTTPS");
  }
  if (url.username || url.password) {
    throw new DingTalkRobotConfigError("钉钉机器人 Webhook 不能包含用户凭据");
  }
  if (url.hostname.toLowerCase() !== "oapi.dingtalk.com") {
    throw new DingTalkRobotConfigError("Webhook 不是钉钉官方机器人地址");
  }
  if (url.port && url.port !== "443") {
    throw new DingTalkRobotConfigError("钉钉机器人 Webhook 端口无效");
  }
  if (url.pathname !== "/robot/send") {
    throw new DingTalkRobotConfigError("钉钉机器人 Webhook 路径无效");
  }
  if (!url.searchParams.get("access_token")?.trim()) {
    throw new DingTalkRobotConfigError("钉钉机器人 Webhook 缺少 access_token");
  }
  if (url.hash) {
    throw new DingTalkRobotConfigError("钉钉机器人 Webhook 不能包含锚点");
  }

  return url.toString();
}
