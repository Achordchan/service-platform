export const MAIL_TEMPLATE_KEYS = [
  "PASSWORD_RESET",
  "STAFF_INVITATION",
  "CUSTOMER_OWNER_INVITATION",
  "CUSTOMER_MEMBER_INVITATION",
  "TEST_EMAIL",
] as const;

export type MailTemplateKey = (typeof MAIL_TEMPLATE_KEYS)[number];

export type MailTemplateContent = {
  subject: string;
  previewText: string;
  heading: string;
  body: string;
  actionLabel: string | null;
};

export type MailTemplateDefinition = {
  key: MailTemplateKey;
  name: string;
  description: string;
  variables: Array<{
    key: string;
    label: string;
    sample: string;
  }>;
  defaults: MailTemplateContent;
};

const definitions: Record<MailTemplateKey, MailTemplateDefinition> = {
  PASSWORD_RESET: {
    key: "PASSWORD_RESET",
    name: "密码重置",
    description: "用户通过登录页申请重置密码时发送。",
    variables: [
      { key: "recipientName", label: "收件人姓名", sample: "张三" },
      {
        key: "recipientEmail",
        label: "收件人邮箱",
        sample: "zhangsan@example.com",
      },
      { key: "expiresIn", label: "有效时间", sample: "1 小时" },
    ],
    defaults: {
      subject: "{{recipientName}}，请重置服务支持中心密码",
      previewText: "{{recipientEmail}} 的密码重置链接将在 {{expiresIn}} 后失效",
      heading: "你好，{{recipientName}}",
      body: "我们收到了 {{recipientEmail}} 的密码重置请求。请在 {{expiresIn}} 内完成操作；若非本人发起，可忽略此邮件。",
      actionLabel: "设置新密码",
    },
  },
  STAFF_INVITATION: {
    key: "STAFF_INVITATION",
    name: "协作人员邀请",
    description: "邀请项目负责人、技术人员或外包协作人员时发送。",
    variables: [
      { key: "recipientName", label: "收件人姓名", sample: "李明" },
      {
        key: "recipientEmail",
        label: "收件人邮箱",
        sample: "liming@example.com",
      },
      { key: "inviterName", label: "邀请人姓名", sample: "王经理" },
      {
        key: "inviterEmail",
        label: "邀请人邮箱",
        sample: "manager@achord.cn",
      },
      { key: "roleGroupName", label: "角色组", sample: "项目负责人" },
      { key: "phone", label: "联系电话", sample: "13800000000" },
      { key: "company", label: "公司", sample: "示例科技有限公司" },
      { key: "jobTitle", label: "职位", sample: "技术负责人" },
      { key: "wechat", label: "微信", sample: "example_wechat" },
      { key: "website", label: "网站", sample: "https://example.com" },
      { key: "location", label: "所在地", sample: "上海" },
      {
        key: "contactNotes",
        label: "联系备注",
        sample: "负责项目技术对接",
      },
      { key: "expiresIn", label: "有效时间", sample: "24 小时" },
    ],
    defaults: {
      subject: "{{recipientName}}，邀请你加入服务支持协作",
      previewText: "{{inviterName}} 邀请你以“{{roleGroupName}}”身份加入",
      heading: "你好，{{recipientName}}",
      body: "{{inviterName}} 邀请你以“{{roleGroupName}}”身份加入服务支持中心。请在 {{expiresIn}} 内设置账号密码，之后可登录后台处理被授权的项目与服务请求。",
      actionLabel: "设置账号并加入",
    },
  },
  CUSTOMER_OWNER_INVITATION: {
    key: "CUSTOMER_OWNER_INVITATION",
    name: "客户 Owner 邀请",
    description: "创建客户空间并邀请首位 Owner 设置账号时发送。",
    variables: [
      { key: "recipientName", label: "收件人姓名", sample: "陈总" },
      {
        key: "recipientEmail",
        label: "收件人邮箱",
        sample: "owner@example.com",
      },
      { key: "inviterName", label: "邀请人姓名", sample: "服务支持团队" },
      {
        key: "inviterEmail",
        label: "邀请人邮箱",
        sample: "support@achord.cn",
      },
      { key: "customerName", label: "客户名称", sample: "示例客户" },
      {
        key: "spaceName",
        label: "客户空间（兼容变量）",
        sample: "示例客户",
      },
      { key: "expiresIn", label: "有效时间", sample: "24 小时" },
    ],
    defaults: {
      subject: "{{recipientName}}，{{customerName}} 服务空间已开通",
      previewText: "{{inviterName}} 已为你开通“{{customerName}}”客户服务空间",
      heading: "你好，{{recipientName}}",
      body: "{{inviterName}} 已为你开通“{{customerName}}”客户服务空间。请在 {{expiresIn}} 内设置账号密码，之后即可查看项目进度并提交服务请求。",
      actionLabel: "设置账号并加入",
    },
  },
  CUSTOMER_MEMBER_INVITATION: {
    key: "CUSTOMER_MEMBER_INVITATION",
    name: "客户成员邀请",
    description: "客户 Owner 或管理员邀请其他成员加入空间时发送。",
    variables: [
      {
        key: "recipientEmail",
        label: "收件人邮箱",
        sample: "member@example.com",
      },
      { key: "inviterName", label: "邀请人姓名", sample: "陈总" },
      {
        key: "inviterEmail",
        label: "邀请人邮箱",
        sample: "owner@example.com",
      },
      { key: "customerName", label: "客户名称", sample: "示例客户" },
      {
        key: "spaceName",
        label: "客户空间（兼容变量）",
        sample: "示例客户",
      },
      { key: "expiresIn", label: "有效时间", sample: "24 小时" },
    ],
    defaults: {
      subject: "邀请你加入 {{customerName}}",
      previewText: "{{inviterName}} 邀请你加入“{{customerName}}”客户服务空间",
      heading: "你已被邀请加入服务支持中心",
      body: "{{inviterName}} 邀请你加入“{{customerName}}”客户服务空间。请在 {{expiresIn}} 内完成账号设置，之后即可查看项目进度并提交服务请求。",
      actionLabel: "接受邀请",
    },
  },
  TEST_EMAIL: {
    key: "TEST_EMAIL",
    name: "邮件配置测试",
    description: "平台管理员验证当前邮件通道和域名配置时发送。",
    variables: [],
    defaults: {
      subject: "服务支持中心邮件配置测试",
      previewText: "这是一封邮件投递配置测试",
      heading: "邮件发送配置正常",
      body: "这是一封由平台管理员发起的测试邮件，用于验证当前发信域名、发件人和回复地址配置。",
      actionLabel: "打开服务支持中心",
    },
  },
};

const placeholderPattern = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

export function isMailTemplateKey(value: string): value is MailTemplateKey {
  return MAIL_TEMPLATE_KEYS.includes(value as MailTemplateKey);
}

export function getMailTemplateDefinition(key: MailTemplateKey) {
  return definitions[key];
}

export function listMailTemplateDefinitions() {
  return MAIL_TEMPLATE_KEYS.map((key) => definitions[key]);
}

export function sampleVariablesForTemplate(key: MailTemplateKey) {
  return Object.fromEntries(
    definitions[key].variables.map((variable) => [
      variable.key,
      variable.sample,
    ]),
  );
}

export function validateTemplatePlaceholders(
  key: MailTemplateKey,
  content: MailTemplateContent,
) {
  const allowed = new Set(
    definitions[key].variables.map((variable) => variable.key),
  );
  const values = [
    content.subject,
    content.previewText,
    content.heading,
    content.body,
    content.actionLabel ?? "",
  ];

  for (const value of values) {
    for (const match of value.matchAll(placeholderPattern)) {
      if (!allowed.has(match[1])) {
        throw new Error(`模板变量 {{${match[1]}}} 不可用于此模板`);
      }
    }
  }
}

export function renderTemplateContent(
  key: MailTemplateKey,
  content: MailTemplateContent,
  variables: Record<string, string>,
) {
  validateTemplatePlaceholders(key, content);
  const allowed = new Set(
    definitions[key].variables.map((variable) => variable.key),
  );
  for (const variable of Object.keys(variables)) {
    if (!allowed.has(variable)) {
      throw new Error(`模板变量 ${variable} 不可用于此模板`);
    }
  }

  const renderValue = (value: string) =>
    value.replace(placeholderPattern, (_match, variable: string) => {
      const replacement = variables[variable];
      if (replacement === undefined) {
        throw new Error(`邮件模板缺少变量 ${variable}`);
      }
      return replacement;
    });

  return {
    subject: renderValue(content.subject),
    previewText: renderValue(content.previewText),
    heading: renderValue(content.heading),
    body: renderValue(content.body),
    actionLabel: content.actionLabel
      ? renderValue(content.actionLabel)
      : null,
  };
}

export function normalizeMailActionUrl(actionUrl?: string) {
  if (!actionUrl) return null;
  const parsed = new URL(actionUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("邮件操作链接仅支持 HTTP 或 HTTPS");
  }
  return parsed.toString();
}
