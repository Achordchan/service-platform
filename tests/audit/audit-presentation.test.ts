import { describe, expect, it } from "vitest";
import {
  auditCategoryFor,
  auditCategoryLabel,
  buildAuditPresentation,
  describeUserAgent,
  formatDuration,
  formatFileSize,
  ipScopeFor,
  loginFailureReasonFor,
  loginMethodFor,
  platformRoleLabel,
} from "@/modules/audit/audit-presentation";
import type { AuditObjectView } from "@/modules/audit/audit-types";

const request: AuditObjectView = {
  label: "#SR-1001 打印机连不上",
  typeLabel: "工单",
  href: "/staff/requests/r1",
};
const project: AuditObjectView = {
  label: "官网改版",
  typeLabel: "项目",
  href: "/staff/projects/p1",
};

function present(
  input: Parameters<typeof buildAuditPresentation>[0],
): ReturnType<typeof buildAuditPresentation> {
  return buildAuditPresentation(input);
}

describe("审计动作分类", () => {
  it("按前缀归入普通人能理解的大类", () => {
    expect(auditCategoryFor("USER_LOGIN")).toBe("AUTH");
    expect(auditCategoryFor("REQUEST_STATUS_CHANGED")).toBe("REQUEST");
    expect(auditCategoryFor("MILESTONE_CREATED")).toBe("PROJECT");
    expect(auditCategoryFor("CUSTOMER_SPACE_UPDATED")).toBe("CUSTOMER");
    expect(auditCategoryFor("ROLE_GROUP_UPDATED")).toBe("TEAM");
    expect(auditCategoryFor("PLATFORM_SETTINGS_UPDATED")).toBe("SETTINGS");
    expect(auditCategoryFor("SYSTEM_ERROR_LOG_EXPORTED")).toBe("SYSTEM");
    expect(auditCategoryFor("SERVICE_TYPE_UPDATED")).toBe("SETTINGS");
    // 重叠前缀按声明顺序取第一个：通知偏好属于账号，不属于设置
    expect(auditCategoryFor("NOTIFICATION_PREFERENCE_TYPE_UPDATED")).toBe("AUTH");
    expect(auditCategoryFor("SOMETHING_NEW")).toBe("OTHER");
    expect(auditCategoryLabel("AUTH")).toBe("登录与账号");
  });
});

describe("设备与来源解析", () => {
  it("把 UA 翻译成浏览器 / 系统 / 设备类型", () => {
    const chromeMac = describeUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36",
    );
    expect(chromeMac).toMatchObject({ browser: "Chrome", os: "macOS", deviceType: "电脑" });

    const wechatIphone = describeUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 MicroMessenger/8.0.50",
    );
    expect(wechatIphone).toMatchObject({ browser: "微信", os: "iOS", deviceType: "手机" });

    expect(describeUserAgent(null).label).toBe("未知设备");
  });

  it("只区分内网/公网，不编造归属地", () => {
    expect(ipScopeFor("192.168.1.20")).toBe("PRIVATE");
    expect(ipScopeFor("10.0.0.8")).toBe("PRIVATE");
    expect(ipScopeFor("172.20.1.1")).toBe("PRIVATE");
    expect(ipScopeFor("::ffff:127.0.0.1")).toBe("PRIVATE");
    expect(ipScopeFor("8.8.8.8")).toBe("PUBLIC");
    expect(ipScopeFor(null)).toBeNull();
  });

  it("登录方式与失败原因来自 metadata，而不是猜", () => {
    expect(loginMethodFor({ path: "/sign-in/email" })).toBe("密码登录");
    expect(loginMethodFor({ path: "web-qr-login" })).toBe("小程序扫码");
    expect(loginMethodFor({ path: "miniapp-bind", method: "code" })).toBe(
      "微信绑定（绑定码）",
    );
    expect(loginMethodFor({})).toBeNull();
    expect(loginFailureReasonFor({ code: "INVALID_EMAIL_OR_PASSWORD" })).toBe(
      "邮箱或密码错误",
    );
    expect(loginFailureReasonFor({})).toBeNull();
  });

  it("时长与文件大小给量级，不假装精确", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(30_000)).toBe("不足 1 分钟");
    expect(formatDuration(90 * 60_000)).toBe("1 小时 30 分钟");
    expect(formatDuration(26 * 3_600_000)).toBe("1 天 2 小时");
    expect(formatFileSize(2_048)).toBe("2.0 KB");
    expect(formatFileSize(null)).toBeNull();
  });
});

describe("审计事件的普通话摘要", () => {
  it("状态变更说清从什么改成什么", () => {
    const result = present({
      action: "REQUEST_STATUS_CHANGED",
      actionLabel: "变更工单状态",
      resourceType: "ServiceRequest",
      metadata: { previousStatus: "PENDING", status: "RESOLVED", source: "MANUAL" },
      object: request,
      scope: project,
      actorKind: "USER",
      actorRoleLabel: "项目负责人",
    });
    expect(result.summary).toBe(
      "将工单「#SR-1001 打印机连不上」的状态从「待处理」改为「已解决」",
    );
    expect(result.changes).toEqual([
      { label: "状态", from: "待处理", to: "已解决" },
    ]);
  });

  it("登录事件带登录方式；失败事件带原因", () => {
    const login = present({
      action: "USER_LOGIN",
      actionLabel: "登录",
      resourceType: "User",
      metadata: { path: "/sign-in/email", sessionId: "s1" },
      object: null,
      scope: null,
      actorKind: "USER",
      actorRoleLabel: "客户",
    });
    expect(login.summary).toBe("登录了平台（密码登录）");
    expect(login.context).toEqual([{ label: "登录方式", value: "密码登录" }]);

    const failed = present({
      action: "USER_LOGIN_FAILED",
      actionLabel: "登录失败",
      resourceType: "User",
      metadata: { email: "a@example.test", code: "INVALID_EMAIL_OR_PASSWORD" },
      object: null,
      scope: null,
      actorKind: "ANONYMOUS",
      actorRoleLabel: "未登录尝试",
    });
    expect(failed.summary).toBe("尝试登录，但邮箱或密码错误");
    expect(failed.context).toEqual([
      { label: "尝试的账号", value: "a@example.test" },
      { label: "失败原因", value: "邮箱或密码错误" },
    ]);
  });

  it("客户提交与员工创建用不同措辞", () => {
    const base = {
      action: "REQUEST_CREATED",
      actionLabel: "创建工单",
      resourceType: "ServiceRequest",
      metadata: { number: "SR-1001", priority: "URGENT" },
      object: request,
      scope: project,
      actorKind: "USER" as const,
    };
    expect(
      present({ ...base, actorRoleLabel: "客户" }).summary,
    ).toBe("提交了工单「#SR-1001 打印机连不上」");
    expect(
      present({ ...base, actorRoleLabel: "技术人员" }).summary,
    ).toBe("创建了工单「#SR-1001 打印机连不上」");
  });

  it("项目成员变更能带上成员名与角色变化", () => {
    const result = present({
      action: "PROJECT_STAFF_UPDATED",
      actionLabel: "调整项目成员",
      resourceType: "ProjectStaff",
      metadata: {
        userId: "u2",
        previousRole: "TECHNICIAN",
        role: "PROJECT_MANAGER",
      },
      object: project,
      scope: null,
      actorKind: "USER",
      actorRoleLabel: "平台管理员",
      resolveUserName: (id) => (id === "u2" ? "李娜" : null),
    });
    expect(result.summary).toBe("调整了 李娜 在项目「官网改版」中的角色");
    expect(result.changes).toEqual([
      { label: "项目角色", from: "技术人员", to: "项目负责人" },
    ]);
  });

  it("更新类动作列出本次改了什么，而不泄露正文内容", () => {
    const result = present({
      action: "PROJECT_UPDATED",
      actionLabel: "更新项目",
      resourceType: "Project",
      metadata: { title: "官网改版", description: "<p>很长的正文</p>" },
      object: project,
      scope: null,
      actorKind: "USER",
      actorRoleLabel: "项目负责人",
    });
    expect(result.summary).toBe("更新了项目「官网改版」");
    expect(result.context).toEqual([
      { label: "本次修改", value: "标题、描述" },
    ]);
    expect(JSON.stringify(result)).not.toContain("很长的正文");
  });

  it("附件、里程碑与兜底动作都给出可读句子", () => {
    const attachment = present({
      action: "ATTACHMENT_UPLOADED",
      actionLabel: "上传附件",
      resourceType: "Attachment",
      metadata: { originalName: "年度报告.pdf", mimeType: "application/pdf", size: 2_048 },
      object: { label: "年度报告.pdf", typeLabel: "附件", href: null },
      scope: project,
      actorKind: "USER",
      actorRoleLabel: "客户",
    });
    expect(attachment.summary).toBe("上传了文件「年度报告.pdf」");
    expect(attachment.context).toEqual([
      { label: "文件类型", value: "PDF 文档" },
      { label: "文件大小", value: "2.0 KB" },
    ]);

    const milestone = present({
      action: "MILESTONE_CREATED",
      actionLabel: "创建里程碑",
      resourceType: "Milestone",
      metadata: { title: "一期验收" },
      object: { label: "一期验收", typeLabel: "里程碑", href: null },
      scope: project,
      actorKind: "USER",
      actorRoleLabel: "项目负责人",
    });
    expect(milestone.summary).toBe("在项目「官网改版」中创建了里程碑「一期验收」");

    const fallback = present({
      action: "PLUGIN_HEALTH_CHECKED",
      actionLabel: "检查插件健康",
      resourceType: "PluginInstallation",
      metadata: {},
      object: null,
      scope: null,
      actorKind: "USER",
      actorRoleLabel: "平台管理员",
    });
    expect(fallback.summary).toBe("检查插件健康");
  });

  it("未知状态值不会抛错，也不会被误译", () => {
    const result = present({
      action: "REQUEST_STATUS_CHANGED",
      actionLabel: "变更工单状态",
      resourceType: "ServiceRequest",
      metadata: { previousStatus: "WEIRD", status: "ALSO_WEIRD" },
      object: request,
      scope: project,
      actorKind: "USER",
      actorRoleLabel: "平台管理员",
    });
    expect(result.changes[0]).toMatchObject({ from: "WEIRD", to: "ALSO_WEIRD" });
  });

  it("角色名有中文映射，未知值原样返回", () => {
    expect(platformRoleLabel("PLATFORM_ADMIN")).toBe("平台管理员");
    expect(platformRoleLabel("CUSTOMER")).toBe("客户");
    expect(platformRoleLabel("SOMETHING")).toBe("SOMETHING");
    expect(platformRoleLabel(null)).toBeNull();
  });
});
