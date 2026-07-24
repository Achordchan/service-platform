import { z } from "zod";

export const DINGTALK_ROBOT_KEYWORD = "工单通知";

export const DINGTALK_ROBOT_EVENT_TYPES = [
  "REQUEST_CREATED",
  "REQUEST_CUSTOMER_REPLIED",
  "CONTENT_RISK_ALERT",
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
  { key: "requestNumber", label: "服务请求编号", sample: "REQ-1001" },
  { key: "requestTitle", label: "服务请求主题", sample: "无法连接 VPN" },
  { key: "customerName", label: "客户", sample: "示例客户" },
  { key: "projectName", label: "项目", sample: "企业 VPN 服务" },
  { key: "priorityLabel", label: "优先级", sample: "高" },
  { key: "actorName", label: "操作人", sample: "张三" },
  { key: "contentSummary", label: "内容摘要", sample: "登录后页面持续提示连接失败" },
  { key: "occurredAt", label: "发生时间", sample: "2026/07/23 10:30" },
  { key: "targetLabel", label: "内容位置", sample: "项目进度" },
  { key: "riskSummary", label: "脱敏告警摘要", sample: "系统已撤回疑似包含站外联系引导的公开内容" },
] as const;

export const DINGTALK_ROBOT_TEMPLATE_DEFINITIONS = [
  {
    key: "REQUEST_CREATED",
    name: "新建服务请求",
    description: "客户或后台人员创建新的服务请求后发送。",
  },
  {
    key: "REQUEST_CUSTOMER_REPLIED",
    name: "客户公开回复",
    description: "客户或外部联系人公开回复服务请求后发送。",
  },
  {
    key: "CONTENT_RISK_ALERT",
    name: "内容风控告警",
    description: "联系方式、站外交易风险或风控插件异常时发送脱敏告警。",
  },
] as const;

export const DINGTALK_ROBOT_DEFAULT_CONFIG: DingTalkRobotConfig = {
  templates: {
    REQUEST_CREATED: {
      title: "新服务请求待处理",
      body: [
        "- **服务请求**：{{requestNumber}} {{requestTitle}}",
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
        "- **服务请求**：{{requestNumber}} {{requestTitle}}",
        "- **客户**：{{customerName}}",
        "- **项目**：{{projectName}}",
        "- **回复人**：{{actorName}}",
        "- **回复摘要**：{{contentSummary}}",
        "- **时间**：{{occurredAt}}",
      ].join("\n"),
    },
    CONTENT_RISK_ALERT: {
      title: "内容风控告警",
      body: [
        "- **发送人**：{{actorName}}",
        "- **项目**：{{projectName}}",
        "- **服务请求**：{{requestNumber}} {{requestTitle}}",
        "- **位置**：{{targetLabel}}",
        "- **摘要**：{{riskSummary}}",
        "- **时间**：{{occurredAt}}",
        "",
        "原始内容仅可在平台受限风控记录中查看。",
      ].join("\n"),
    },
  },
};

const LEGACY_DEFAULT_TEMPLATES: Partial<
  Record<DingTalkRobotEventType, DingTalkRobotTemplate>
> = {
  REQUEST_CUSTOMER_REPLIED: {
    title: "客户有新回复",
    body: [
      "- **服务请求**：{{requestNumber}} {{requestTitle}}",
      "- **客户**：{{customerName}}",
      "- **项目**：{{projectName}}",
      "- **回复人**：{{actorName}}",
      "- **时间**：{{occurredAt}}",
    ].join("\n"),
  },
  CONTENT_RISK_ALERT: {
    title: "内容风控告警",
    body: [
      "- **位置**：{{targetLabel}}",
      "- **摘要**：{{riskSummary}}",
      "- **时间**：{{occurredAt}}",
      "",
      "原始内容仅可在平台受限风控记录中查看。",
    ].join("\n"),
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
        REQUEST_CREATED: dingTalkRobotTemplateSchema.default(
          DINGTALK_ROBOT_DEFAULT_CONFIG.templates.REQUEST_CREATED,
        ),
        REQUEST_CUSTOMER_REPLIED: dingTalkRobotTemplateSchema.default(
          DINGTALK_ROBOT_DEFAULT_CONFIG.templates.REQUEST_CUSTOMER_REPLIED,
        ),
        CONTENT_RISK_ALERT: dingTalkRobotTemplateSchema.default(
          DINGTALK_ROBOT_DEFAULT_CONFIG.templates.CONTENT_RISK_ALERT,
        ),
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
  const templates = Object.fromEntries(
    DINGTALK_ROBOT_EVENT_TYPES.map((eventType) => {
      const template = parsed.data.templates[eventType];
      const legacyDefault = LEGACY_DEFAULT_TEMPLATES[eventType];
      return [
        eventType,
        legacyDefault && templatesMatch(template, legacyDefault)
          ? DINGTALK_ROBOT_DEFAULT_CONFIG.templates[eventType]
          : template,
      ];
    }),
  ) as DingTalkRobotConfig["templates"];
  for (const template of Object.values(templates)) {
    validateTemplateVariables(template);
  }
  return { templates };
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

function templatesMatch(
  left: DingTalkRobotTemplate,
  right: DingTalkRobotTemplate,
) {
  return left.title === right.title && left.body === right.body;
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
