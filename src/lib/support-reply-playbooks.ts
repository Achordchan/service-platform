import { escapeHtmlText } from "@/lib/message-content";

export type SupportReplyPlaybook = {
  key: string;
  category: "REMOTE" | "DIAGNOSTIC" | "INFORMATION";
  title: string;
  summary: string;
  introduction: string;
  content?: string;
  steps: string[];
  safetyNotes: string[];
};

export type SupportReplyPlaybookView = SupportReplyPlaybook & {
  active: boolean;
  sortOrder: number;
  isBuiltin: boolean;
  updatedAt: string;
  deletedAt: string | null;
};

export const defaultSupportReplyPlaybooks: SupportReplyPlaybook[] = [
  {
    key: "windows-quick-assist",
    category: "REMOTE",
    title: "Windows 快速助手",
    summary: "指导客户使用 Windows 自带工具发起一次性远程协助。",
    introduction:
      "为了更快定位问题，我们可以通过 Windows 快速助手进行一次性远程协助。请按下面步骤操作：",
    steps: [
      "打开开始菜单，搜索并启动“快速助手”。",
      "等待服务人员提供一次性安全代码，在快速助手中输入该代码。",
      "确认显示的协助人员信息无误后，选择允许屏幕共享。",
      "需要服务人员操作时，请再次确认控制请求；处理完成后直接关闭快速助手。",
    ],
    safetyNotes: [
      "请勿提供系统登录密码、短信验证码、支付密码或其他敏感凭据。",
      "远程过程中请保持在场，发现异常操作可立即结束共享。",
    ],
  },
  {
    key: "remote-desktop-tool",
    category: "REMOTE",
    title: "AnyDesk / RustDesk 远程协助",
    summary: "适用于没有快速助手或需要跨平台远程处理的场景。",
    introduction:
      "如果当前设备无法使用系统自带的远程工具，可以使用 AnyDesk 或 RustDesk 临时协助。操作步骤如下：",
    steps: [
      "从软件官方网站下载并运行客户端，不要使用来源不明的安装包。",
      "将界面显示的一次性设备地址发送给服务人员。",
      "收到连接请求后核对协助人员信息，再手动点击接受。",
      "仅开启本次排查需要的权限，处理完成后结束会话并退出软件。",
    ],
    safetyNotes: [
      "不要设置或发送无人值守访问密码。",
      "不要允许访问与本次问题无关的文件、剪贴板或系统设置。",
    ],
  },
  {
    key: "server-ssh-access",
    category: "REMOTE",
    title: "服务器 SSH 临时排查",
    summary: "指导客户安全提供受限、可撤销的服务器排查权限。",
    introduction:
      "如需检查服务器运行状态，请创建临时、受限的 SSH 排查权限，并提供以下信息：",
    steps: [
      "提供服务器地址、SSH 端口、系统版本和问题发生时间。",
      "优先创建临时用户并使用 SSH 公钥授权，不要发送 root 密码。",
      "仅授予本次排查所需目录和命令权限，并限制允许连接的来源 IP。",
      "排查结束后删除临时公钥或账号，并检查登录日志。",
    ],
    safetyNotes: [
      "请先备份重要配置和数据，不要在工单中发送长期密钥或数据库密码。",
      "涉及生产变更时，我们会先说明操作内容并等待确认。",
    ],
  },
  {
    key: "browser-network-log",
    category: "DIAGNOSTIC",
    title: "浏览器网络日志（HAR）",
    summary: "用于排查页面请求失败、接口报错和加载异常。",
    introduction:
      "请按以下步骤记录浏览器网络日志，便于我们定位页面请求异常：",
    steps: [
      "打开出现问题的页面，按 F12 进入开发者工具。",
      "切换到“网络 / Network”面板，并开启“保留日志 / Preserve log”。",
      "清空现有记录后重新执行一次出现问题的操作。",
      "在请求列表空白处右键，导出包含内容的 HAR 文件并作为附件上传。",
    ],
    safetyNotes: [
      "HAR 可能包含登录令牌、Cookie 或请求参数，上传前请确认工单仅对授权人员可见。",
      "如包含支付、身份或隐私数据，请先告知我们，不要直接公开发送。",
    ],
  },
  {
    key: "problem-information",
    category: "INFORMATION",
    title: "补充问题信息",
    summary: "一次收集复现步骤、环境、时间和错误证据。",
    introduction:
      "为了准确复现并处理问题，请补充以下信息：",
    steps: [
      "问题发生的准确时间，以及是否每次都能复现。",
      "完整操作步骤、预期结果和实际结果。",
      "使用的设备、操作系统、浏览器或客户端版本。",
      "完整错误提示、截图或录屏；请保留页面地址和时间信息。",
      "近期是否修改过配置、网络、账号权限或部署版本。",
    ],
    safetyNotes: [
      "截图和日志请遮挡密码、验证码、密钥及个人隐私信息。",
    ],
  },
];

export const supportReplyPlaybooks = defaultSupportReplyPlaybooks;

export function getDefaultSupportReplyPlaybook(key: string) {
  return (
    defaultSupportReplyPlaybooks.find((playbook) => playbook.key === key) ?? null
  );
}

export function getDefaultSupportReplyPlaybookOrder(key: string) {
  const index = defaultSupportReplyPlaybooks.findIndex(
    (playbook) => playbook.key === key,
  );
  return index === -1 ? null : (index + 1) * 10;
}

export function buildDefaultSupportReplyPlaybookContent(
  playbook: SupportReplyPlaybook,
) {
  const steps = playbook.steps
    .map((step) => `<li>${escapeHtmlText(step)}</li>`)
    .join("");
  return `<p>${escapeHtmlText(playbook.introduction)}</p><ol>${steps}</ol>`;
}

export function snapshotSupportReplyPlaybook(
  playbook: SupportReplyPlaybook,
): SupportReplyPlaybook {
  return {
    key: playbook.key,
    category: playbook.category,
    title: playbook.title,
    summary: playbook.summary,
    introduction: playbook.introduction,
    ...(playbook.content ? { content: playbook.content } : {}),
    steps: [...playbook.steps],
    safetyNotes: [...playbook.safetyNotes],
  };
}

export function buildSupportPlaybookMessageBody(
  playbook: SupportReplyPlaybook,
) {
  return `<p><strong>处理指南：${escapeHtmlText(
    playbook.title,
  )}</strong></p><p>${escapeHtmlText(playbook.summary)}</p>`;
}

export function parseSupportPlaybookSnapshot(
  value: unknown,
): SupportReplyPlaybook | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const category = record.category;
  if (
    typeof record.key !== "string" ||
    (category !== "REMOTE" &&
      category !== "DIAGNOSTIC" &&
      category !== "INFORMATION") ||
    typeof record.title !== "string" ||
    typeof record.summary !== "string" ||
    typeof record.introduction !== "string" ||
    (record.content !== undefined && typeof record.content !== "string") ||
    !Array.isArray(record.steps) ||
    !record.steps.every((step) => typeof step === "string") ||
    !Array.isArray(record.safetyNotes) ||
    !record.safetyNotes.every((note) => typeof note === "string")
  ) {
    return null;
  }
  return {
    key: record.key,
    category,
    title: record.title,
    summary: record.summary,
    introduction: record.introduction,
    ...(typeof record.content === "string" ? { content: record.content } : {}),
    steps: record.steps as string[],
    safetyNotes: record.safetyNotes as string[],
  };
}
