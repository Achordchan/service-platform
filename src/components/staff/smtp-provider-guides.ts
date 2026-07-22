export type SmtpProviderGuide = {
  key: string;
  name: string;
  summary: string;
  host: string;
  port: number;
  secure: boolean;
  usernameHint: string;
  credentialHint: string;
  steps: string[];
  warning?: string;
  docsUrl?: string;
};

export const SMTP_PROVIDER_GUIDES: SmtpProviderGuide[] = [
  {
    key: "qq",
    name: "QQ 邮箱",
    summary: "个人 QQ 邮箱，使用 SMTP 授权码。",
    host: "smtp.qq.com",
    port: 465,
    secure: true,
    usernameHint: "完整 QQ 邮箱地址",
    credentialHint: "邮箱设置中生成的 SMTP 授权码，不是 QQ 登录密码",
    steps: [
      "进入 QQ 邮箱设置并开启 POP3/SMTP 服务。",
      "按邮箱安全流程生成授权码。",
      "用户名填写完整邮箱地址，密码填写授权码。",
      "保存后先执行连接检测，再发送测试邮件。",
    ],
  },
  {
    key: "netease-163",
    name: "网易 163 邮箱",
    summary: "个人 163 邮箱，使用客户端授权密码。",
    host: "smtp.163.com",
    port: 465,
    secure: true,
    usernameHint: "完整 163 邮箱地址",
    credentialHint: "客户端授权密码，不是网页登录密码",
    steps: [
      "进入网易邮箱设置并开启 SMTP 服务。",
      "创建或重置客户端授权密码。",
      "用户名填写完整邮箱地址，密码填写客户端授权密码。",
      "保存后先执行连接检测，再发送测试邮件。",
    ],
  },
  {
    key: "google",
    name: "Gmail / Google Workspace",
    summary: "使用应用专用密码，或由 Workspace 管理员配置 SMTP Relay。",
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    usernameHint: "完整 Gmail 或 Workspace 邮箱地址",
    credentialHint: "开启两步验证后创建的应用专用密码",
    steps: [
      "确认账号已开启两步验证，并允许创建应用专用密码。",
      "创建新的应用专用密码，用户名填写完整邮箱地址。",
      "个人邮箱使用 smtp.gmail.com；Workspace 组织也可由管理员配置 SMTP Relay。",
      "保存后执行连接检测，并向可接收邮箱发送测试邮件。",
    ],
    warning: "受组织安全策略管理的账号可能无法创建应用专用密码。",
    docsUrl: "https://support.google.com/a/answer/176600?hl=zh-Hans",
  },
  {
    key: "microsoft-365",
    name: "Microsoft 365",
    summary: "客户端提交使用 587 端口和 STARTTLS。",
    host: "smtp.office365.com",
    port: 587,
    secure: false,
    usernameHint: "完整 Microsoft 365 邮箱地址",
    credentialHint: "允许 SMTP AUTH 的邮箱凭据",
    steps: [
      "在 Exchange 管理设置中确认组织和目标邮箱允许 SMTP AUTH。",
      "主机填写 smtp.office365.com，端口使用 587 和 STARTTLS。",
      "用户名填写完整邮箱地址，并使用该邮箱允许的凭据。",
      "保存后执行连接检测；身份验证失败时检查安全默认值和邮箱级 SMTP AUTH 设置。",
    ],
    warning:
      "截至 2026 年 7 月，SMTP AUTH 基本身份验证仍按原方式运行；Microsoft 计划从 2026 年 12 月底开始默认关闭。长期接入应规划 OAuth 或 Microsoft Graph。",
    docsUrl:
      "https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission",
  },
  {
    key: "custom",
    name: "自定义企业邮箱",
    summary: "适用于自建邮局、云企业邮箱和托管邮件服务。",
    host: "",
    port: 465,
    secure: true,
    usernameHint: "以服务商提供的信息为准",
    credentialHint: "邮箱密码、授权码或应用专用密码",
    steps: [
      "从邮件服务商后台取得 SMTP 主机、端口和加密方式。",
      "确认服务器允许当前 VPS 出站访问对应端口。",
      "发件人地址应与 SMTP 账号或服务商允许的发信身份一致。",
      "保存后先连接检测，再发送测试邮件；不要直接启用未验证的配置。",
    ],
  },
];
