export const MAIL_TEMPLATE_KEYS = [
  "LOGIN_EMAIL_OTP",
  "PASSWORD_RESET",
  "STAFF_INVITATION",
  "CUSTOMER_OWNER_INVITATION",
  "CUSTOMER_MEMBER_INVITATION",
  "CUSTOMER_EMAIL_CHANGE_VERIFY",
  "CUSTOMER_EMAIL_CHANGE_COMPLETED",
  "CUSTOMER_EMAIL_CHANGE_SECURITY_NOTICE",
  "STANDARD_REQUEST_CUSTOMER_UPDATE",
  "STANDARD_REQUEST_STAFF_CREATED",
  "STANDARD_REQUEST_STAFF_CLAIMED",
  "STANDARD_REQUEST_STAFF_UPDATE",
  "STANDARD_REQUEST_ASSIGNMENT",
  "STANDARD_PROJECT_CREATED",
  "STANDARD_PROJECT_CUSTOMER_UPDATE",
  "EXTERNAL_REQUEST_PUBLIC_REPLY",
  "EXTERNAL_REQUEST_WAITING_CUSTOMER",
  "EXTERNAL_REQUEST_RESOLVED",
  "EXTERNAL_REQUEST_CLOSED",
  "CONTENT_RISK_ALERT",
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
  LOGIN_EMAIL_OTP: {
    key: "LOGIN_EMAIL_OTP",
    name: "登录邮箱验证码",
    description: "用户在登录页选择邮箱验证码登录时发送。",
    variables: [
      {
        key: "recipientEmail",
        label: "登录邮箱",
        sample: "user@example.com",
      },
      { key: "otp", label: "登录验证码", sample: "382941" },
      { key: "expiresIn", label: "有效时间", sample: "5 分钟" },
    ],
    defaults: {
      subject: "登录验证码：{{otp}}",
      previewText: "{{recipientEmail}} 的登录验证码将在 {{expiresIn}} 后失效",
      heading: "邮箱验证码登录",
      body: "你的登录验证码是 {{otp}}。验证码将在 {{expiresIn}} 后失效，请勿转发或告知他人；若非本人操作，可忽略此邮件。",
      actionLabel: null,
    },
  },
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
        sample: "sender@example.com",
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
  CUSTOMER_EMAIL_CHANGE_VERIFY: {
    key: "CUSTOMER_EMAIL_CHANGE_VERIFY",
    name: "账号邮箱变更验证",
    description: "账号本人或平台管理员发起登录邮箱变更后，向新邮箱发送。",
    variables: [
      { key: "recipientName", label: "账号姓名", sample: "张三" },
      { key: "oldEmail", label: "原登录邮箱", sample: "old@example.com" },
      { key: "newEmail", label: "新登录邮箱", sample: "new@example.com" },
      { key: "operatorName", label: "申请人", sample: "张三" },
      { key: "expiresIn", label: "有效时间", sample: "24 小时" },
    ],
    defaults: {
      subject: "{{recipientName}}，请确认新的登录邮箱",
      previewText: "确认后登录邮箱将由 {{oldEmail}} 修改为 {{newEmail}}",
      heading: "确认新的登录邮箱",
      body: "{{operatorName}} 已申请将你的登录邮箱由 {{oldEmail}} 修改为 {{newEmail}}。请在 {{expiresIn}} 内确认；确认后当前账号的其他登录会话将退出。",
      actionLabel: "确认修改邮箱",
    },
  },
  CUSTOMER_EMAIL_CHANGE_COMPLETED: {
    key: "CUSTOMER_EMAIL_CHANGE_COMPLETED",
    name: "账号邮箱变更完成",
    description: "账号确认新邮箱后，向新邮箱发送完成通知。",
    variables: [
      { key: "recipientName", label: "账号姓名", sample: "张三" },
      { key: "oldEmail", label: "原登录邮箱", sample: "old@example.com" },
      { key: "newEmail", label: "新登录邮箱", sample: "new@example.com" },
    ],
    defaults: {
      subject: "{{recipientName}}，登录邮箱已修改",
      previewText: "现在可以使用 {{newEmail}} 登录服务支持中心",
      heading: "登录邮箱修改完成",
      body: "你的登录邮箱已由 {{oldEmail}} 修改为 {{newEmail}}，原有登录会话已退出。请使用新邮箱重新登录。",
      actionLabel: "重新登录",
    },
  },
  CUSTOMER_EMAIL_CHANGE_SECURITY_NOTICE: {
    key: "CUSTOMER_EMAIL_CHANGE_SECURITY_NOTICE",
    name: "账号原邮箱安全提醒",
    description: "登录邮箱修改完成后，向原邮箱发送安全提醒。",
    variables: [
      { key: "recipientName", label: "账号姓名", sample: "张三" },
      { key: "oldEmail", label: "原登录邮箱", sample: "old@example.com" },
      { key: "newEmail", label: "新登录邮箱", sample: "new@example.com" },
      { key: "supportEmail", label: "发件邮箱", sample: "sender@example.com" },
    ],
    defaults: {
      subject: "{{recipientName}}，你的登录邮箱已发生变更",
      previewText: "登录邮箱已由 {{oldEmail}} 修改为 {{newEmail}}",
      heading: "账号安全提醒",
      body: "你的服务支持中心登录邮箱已由 {{oldEmail}} 修改为 {{newEmail}}。若这不是预期操作，请立即联系 {{supportEmail}}。",
      actionLabel: null,
    },
  },
  STANDARD_REQUEST_CUSTOMER_UPDATE: {
    key: "STANDARD_REQUEST_CUSTOMER_UPDATE",
    name: "标准服务请求客户未读提醒",
    description: "客户持续未查看后台公开回复或关键状态时发送。",
    variables: [
      { key: "recipientName", label: "收件人姓名", sample: "张三" },
      { key: "requestNumber", label: "服务请求编号", sample: "SR-20260721-001" },
      { key: "requestTitle", label: "服务请求主题", sample: "接口调用异常" },
      { key: "projectName", label: "项目名称", sample: "API 服务支持" },
      { key: "notificationTitle", label: "更新标题", sample: "技术支持回复了服务请求" },
      { key: "notificationBody", label: "更新摘要", sample: "问题已处理，请重新尝试。" },
    ],
    defaults: {
      subject: "{{requestNumber}} 有新的服务进展",
      previewText: "{{notificationTitle}}：{{notificationBody}}",
      heading: "你好，{{recipientName}}",
      body: "“{{requestTitle}}”有新的服务进展：{{notificationBody}}。请打开 {{projectName}} 查看完整内容。",
      actionLabel: "查看服务请求",
    },
  },
  STANDARD_REQUEST_STAFF_UPDATE: {
    key: "STANDARD_REQUEST_STAFF_UPDATE",
    name: "标准服务请求后台未读提醒",
    description: "处理人持续未查看客户回复时发送。",
    variables: [
      { key: "recipientName", label: "收件人姓名", sample: "技术支持" },
      { key: "requestNumber", label: "服务请求编号", sample: "SR-20260721-001" },
      { key: "requestTitle", label: "服务请求主题", sample: "接口调用异常" },
      { key: "projectName", label: "项目名称", sample: "API 服务支持" },
      { key: "notificationTitle", label: "更新标题", sample: "客户补充了信息" },
      { key: "notificationBody", label: "更新摘要", sample: "问题仍然存在，请继续处理。" },
    ],
    defaults: {
      subject: "{{requestNumber}} 有待处理更新",
      previewText: "{{notificationTitle}}：{{notificationBody}}",
      heading: "你好，{{recipientName}}",
      body: "“{{requestTitle}}”有新的待处理内容：{{notificationBody}}。请进入 {{projectName}} 继续处理。",
      actionLabel: "处理服务请求",
    },
  },
  STANDARD_REQUEST_STAFF_CREATED: {
    key: "STANDARD_REQUEST_STAFF_CREATED",
    name: "客户新建服务请求提醒",
    description: "客户创建新的标准服务请求后，向项目负责人和平台管理员发送。",
    variables: [
      { key: "recipientName", label: "收件人姓名", sample: "金晶" },
      { key: "requesterName", label: "提交人姓名", sample: "张三" },
      { key: "requestNumber", label: "服务请求编号", sample: "SR-20260721-001" },
      { key: "requestTitle", label: "服务请求主题", sample: "网站优化进度咨询" },
      { key: "projectName", label: "项目名称", sample: "网站 SEO 项目" },
      {
        key: "notificationBody",
        label: "问题摘要",
        sample: "想确认当前优化工作是否已经开始，以及预计完成时间。",
      },
    ],
    defaults: {
      subject: "{{projectName}} 收到新服务请求 {{requestNumber}}",
      previewText: "{{requesterName}} 提交了“{{requestTitle}}”",
      heading: "你好，{{recipientName}}",
      body: "你负责或参与管理的项目“{{projectName}}”收到了一条新的服务请求。\n\n提交人：{{requesterName}}\n服务请求编号：{{requestNumber}}\n服务请求主题：{{requestTitle}}\n问题摘要：{{notificationBody}}\n\n请及时查看并安排处理。",
      actionLabel: "查看并处理",
    },
  },
  STANDARD_REQUEST_STAFF_CLAIMED: {
    key: "STANDARD_REQUEST_STAFF_CLAIMED",
    name: "服务请求接手提醒",
    description: "项目人员首次公开回复并自动接手后，向平台管理员发送。",
    variables: [
      { key: "recipientName", label: "收件人姓名", sample: "平台管理员" },
      { key: "requestNumber", label: "服务请求编号", sample: "SR-20260721-001" },
      { key: "requestTitle", label: "服务请求主题", sample: "网站优化进度咨询" },
      { key: "projectName", label: "项目名称", sample: "网站 SEO 项目" },
      { key: "notificationTitle", label: "接手信息", sample: "金晶已接手服务请求" },
      { key: "notificationBody", label: "状态摘要", sample: "该服务请求已由项目人员开始处理。" },
    ],
    defaults: {
      subject: "{{requestNumber}} 已有项目人员接手",
      previewText: "{{notificationTitle}}",
      heading: "你好，{{recipientName}}",
      body: "“{{projectName}}”中的服务请求已有项目人员接手。\n\n{{notificationTitle}}\n服务请求主题：{{requestTitle}}\n处理状态：{{notificationBody}}\n\n你可以打开服务请求查看首次回复与后续处理进展。",
      actionLabel: "查看服务请求",
    },
  },
  STANDARD_REQUEST_ASSIGNMENT: {
    key: "STANDARD_REQUEST_ASSIGNMENT",
    name: "标准服务请求处理人分配提醒",
    description: "用户被分配为新的服务请求处理人且持续未查看时发送。",
    variables: [
      { key: "recipientName", label: "处理人姓名", sample: "李工" },
      { key: "requestNumber", label: "服务请求编号", sample: "SR-20260721-001" },
      { key: "requestTitle", label: "服务请求主题", sample: "接口调用异常" },
      { key: "projectName", label: "项目名称", sample: "API 服务支持" },
      { key: "notificationTitle", label: "更新标题", sample: "你已被设为处理人" },
      { key: "notificationBody", label: "更新摘要", sample: "请查看并开始处理。" },
    ],
    defaults: {
      subject: "{{requestNumber}} 已分配给你",
      previewText: "{{requestTitle}} 等待处理",
      heading: "你好，{{recipientName}}",
      body: "你已被分配处理“{{requestTitle}}”。请进入 {{projectName}} 查看服务请求详情并开始处理。",
      actionLabel: "处理服务请求",
    },
  },
  STANDARD_PROJECT_CUSTOMER_UPDATE: {
    key: "STANDARD_PROJECT_CUSTOMER_UPDATE",
    name: "项目交付未读提醒",
    description: "客户持续未查看已启用邮件提醒的项目交付变化时发送。",
    variables: [
      { key: "recipientName", label: "收件人姓名", sample: "张三" },
      { key: "projectName", label: "项目名称", sample: "官网升级项目" },
      {
        key: "notificationTitle",
        label: "更新标题",
        sample: "项目发布了新的进度",
      },
      {
        key: "notificationBody",
        label: "更新摘要",
        sample: "首页视觉稿已经完成，请查看最新进展。",
      },
    ],
    defaults: {
      subject: "{{projectName}} 有新的项目进展",
      previewText: "{{notificationTitle}}：{{notificationBody}}",
      heading: "你好，{{recipientName}}",
      body: "“{{projectName}}”有新的项目交付变化：{{notificationBody}}。请进入客户中心查看完整内容。",
      actionLabel: "查看项目进展",
    },
  },
  STANDARD_PROJECT_CREATED: {
    key: "STANDARD_PROJECT_CREATED",
    name: "新项目通知",
    description: "项目创建后向客户成员和所选项目负责人发送。",
    variables: [
      { key: "recipientName", label: "收件人姓名", sample: "张三" },
      { key: "projectName", label: "项目名称", sample: "官网升级项目" },
      {
        key: "notificationTitle",
        label: "通知标题",
        sample: "新项目：官网升级项目",
      },
      {
        key: "notificationBody",
        label: "通知摘要",
        sample: "项目已创建，请查看项目资料与后续进展。",
      },
    ],
    defaults: {
      subject: "{{projectName}} 项目已创建",
      previewText: "{{notificationBody}}",
      heading: "你好，{{recipientName}}",
      body: "“{{projectName}}”已创建并与你关联。请进入服务支持中心查看项目资料与后续进展。",
      actionLabel: "查看项目",
    },
  },
  EXTERNAL_REQUEST_PUBLIC_REPLY: {
    key: "EXTERNAL_REQUEST_PUBLIC_REPLY",
    name: "外部服务请求公开回复",
    description: "服务人员回复外部接入用户的服务请求时发送。",
    variables: [
      { key: "recipientName", label: "联系人姓名", sample: "张三" },
      { key: "requestNumber", label: "服务请求编号", sample: "SR-20260717-001" },
      { key: "requestTitle", label: "服务请求主题", sample: "接口调用异常" },
      { key: "senderName", label: "回复人", sample: "技术支持" },
      { key: "messagePreview", label: "回复摘要", sample: "问题已定位，请重新尝试。" },
      { key: "projectName", label: "项目名称", sample: "API 服务支持" },
    ],
    defaults: {
      subject: "{{requestNumber}} 收到新的服务回复",
      previewText: "{{senderName}}：{{messagePreview}}",
      heading: "你好，{{recipientName}}",
      body: "{{senderName}} 回复了“{{requestTitle}}”：{{messagePreview}}。请返回原系统打开 {{projectName}} 查看完整内容。",
      actionLabel: "返回原系统",
    },
  },
  EXTERNAL_REQUEST_WAITING_CUSTOMER: {
    key: "EXTERNAL_REQUEST_WAITING_CUSTOMER",
    name: "外部服务请求等待回复",
    description: "外部服务请求进入等待客户回复状态时发送。",
    variables: [
      { key: "recipientName", label: "联系人姓名", sample: "张三" },
      { key: "requestNumber", label: "服务请求编号", sample: "SR-20260717-001" },
      { key: "requestTitle", label: "服务请求主题", sample: "接口调用异常" },
      { key: "projectName", label: "项目名称", sample: "API 服务支持" },
    ],
    defaults: {
      subject: "{{requestNumber}} 正在等待你的回复",
      previewText: "请返回原系统补充“{{requestTitle}}”所需信息",
      heading: "你好，{{recipientName}}",
      body: "“{{requestTitle}}”正在等待你的回复。请返回原系统打开 {{projectName}} 补充信息。",
      actionLabel: "返回原系统",
    },
  },
  EXTERNAL_REQUEST_RESOLVED: {
    key: "EXTERNAL_REQUEST_RESOLVED",
    name: "外部服务请求已解决",
    description: "外部服务请求被标记为已解决时发送。",
    variables: [
      { key: "recipientName", label: "联系人姓名", sample: "张三" },
      { key: "requestNumber", label: "服务请求编号", sample: "SR-20260717-001" },
      { key: "requestTitle", label: "服务请求主题", sample: "接口调用异常" },
      { key: "projectName", label: "项目名称", sample: "API 服务支持" },
    ],
    defaults: {
      subject: "{{requestNumber}} 已解决",
      previewText: "“{{requestTitle}}”已由服务团队处理完成",
      heading: "服务请求已解决",
      body: "“{{requestTitle}}”已处理完成。你可以返回原系统打开 {{projectName}} 查看处理记录。",
      actionLabel: "返回原系统",
    },
  },
  EXTERNAL_REQUEST_CLOSED: {
    key: "EXTERNAL_REQUEST_CLOSED",
    name: "外部服务请求已关闭",
    description: "外部服务请求关闭时发送。",
    variables: [
      { key: "recipientName", label: "联系人姓名", sample: "张三" },
      { key: "requestNumber", label: "服务请求编号", sample: "SR-20260717-001" },
      { key: "requestTitle", label: "服务请求主题", sample: "接口调用异常" },
      { key: "projectName", label: "项目名称", sample: "API 服务支持" },
    ],
    defaults: {
      subject: "{{requestNumber}} 已关闭",
      previewText: "“{{requestTitle}}”已关闭",
      heading: "服务请求已关闭",
      body: "“{{requestTitle}}”已关闭，历史沟通记录仍可在原系统的 {{projectName}} 中查看。",
      actionLabel: "返回原系统",
    },
  },
  CONTENT_RISK_ALERT: {
    key: "CONTENT_RISK_ALERT",
    name: "内容风控告警",
    description: "联系方式、站外交易风险和插件异常旁路告警。邮件只包含脱敏摘要。",
    variables: [
      { key: "recipientName", label: "平台管理员", sample: "管理员" },
      { key: "notificationTitle", label: "告警标题", sample: "违规内容已撤回" },
      { key: "notificationBody", label: "脱敏摘要", sample: "系统已撤回疑似包含站外联系引导的公开内容。" },
    ],
    defaults: {
      subject: "内容风控告警：{{notificationTitle}}",
      previewText: "{{notificationBody}}",
      heading: "{{recipientName}}，请查看内容风控记录",
      body: "{{notificationBody}}。为避免敏感信息扩散，邮件不会包含原始内容，请登录后台查看受限记录并处理。",
      actionLabel: "查看风控插件",
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
