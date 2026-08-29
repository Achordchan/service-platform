import { describe, expect, it } from "vitest";
import { planProjectStaffActivity } from "@/modules/notifications/activity-delivery";
import {
  notificationTypesForEmailRule,
  ruleKeyForNotificationEmail,
  ruleKeyForProjectNotification,
  NOTIFICATION_DELIVERY_RULES,
} from "@/modules/notifications/notification-delivery-rules";
import {
  canSendStandardProjectEmailForModule,
  isStandardProjectRecipientRelevant,
} from "@/modules/notifications/standard-project-mail-policy";

const base = {
  actorId: "manager-1",
  recipientUserId: "tech-1",
  change: "PROJECT_STAFF_SELF_ADDED",
  audible: true,
  notificationTitle: "你已加入项目：官网升级",
  notificationBody: "你被添加为“官网升级”的技术人员。",
  customerSpaceId: "space-1",
  projectId: "project-1",
  emailEligible: true,
  notificationEnabled: true,
};

describe("项目人员变动通知", () => {
  it("只提醒当事人，事件按 userId 定向且不广播给项目其他人", () => {
    const delivery = planProjectStaffActivity(base);
    expect(delivery.notifications).toHaveLength(1);
    expect(delivery.notifications[0]).toMatchObject({
      type: "PROJECT_STAFF",
      userId: "tech-1",
      projectId: "project-1",
      emailEligible: true,
    });
    expect(delivery.events).toHaveLength(1);
    expect(delivery.events[0]?.userId).toBe("tech-1");
    expect(delivery.events[0]?.customerSpaceId).toBeUndefined();
    expect(delivery.events[0]?.projectId).toBeUndefined();
  });

  it("当事人就是操作者时不自我提醒", () => {
    const delivery = planProjectStaffActivity({
      ...base,
      recipientUserId: "manager-1",
    });
    expect(delivery.notifications).toHaveLength(0);
    expect(delivery.events).toHaveLength(0);
  });

  it("关掉站内通知后只剩刷新事件，声音跟随规则", () => {
    const delivery = planProjectStaffActivity({
      ...base,
      notificationEnabled: false,
      audible: false,
    });
    expect(delivery.notifications).toHaveLength(0);
    expect(delivery.events[0]?.payload).toMatchObject({ audible: false });
  });

  it("邮件不受项目客户可见性开关影响，且不发给客户", () => {
    expect(
      canSendStandardProjectEmailForModule({
        notificationType: "PROJECT_STAFF",
        customerUpdatesEnabled: false,
        customerFilesEnabled: false,
        showMilestones: false,
        showProgress: false,
      }),
    ).toBe(true);
    // 被移出项目的技术人员已不在 projectManagerUserIds / membershipUserIds 里，
    // 仍应收到「你已被移出项目」的邮件
    expect(
      isStandardProjectRecipientRelevant({
        userId: "tech-1",
        platformRole: "TECHNICIAN",
        notificationType: "PROJECT_STAFF",
        membershipUserIds: [],
        projectManagerUserIds: [],
      }),
    ).toBe(true);
    expect(
      isStandardProjectRecipientRelevant({
        userId: "customer-1",
        platformRole: "CUSTOMER",
        notificationType: "PROJECT_STAFF",
        membershipUserIds: ["customer-1"],
        projectManagerUserIds: [],
      }),
    ).toBe(false);
  });

  it("接入通知规则体系：默认对客户隐藏且默认开启邮件", () => {
    expect(ruleKeyForProjectNotification("PROJECT_STAFF")).toBe(
      "PROJECT_STAFF",
    );
    expect(ruleKeyForNotificationEmail("PROJECT_STAFF")).toBe("PROJECT_STAFF");
    expect(notificationTypesForEmailRule("PROJECT_STAFF")).toEqual([
      "PROJECT_STAFF",
    ]);
    const definition = NOTIFICATION_DELIVERY_RULES.find(
      (item) => item.key === "PROJECT_STAFF",
    );
    expect(definition).toMatchObject({
      category: "项目交付",
      customerHidden: true,
      emailSupported: true,
      emailDefaultEnabled: true,
      dingtalkSupported: false,
      wechatSupported: false,
    });
  });
});

describe("项目人员预览的目标校验", () => {
  it("目标只能是可加入项目的内部人员或已在本项目里的成员", async () => {
    const { readFile } = await import("node:fs/promises");
    const service = await readFile(
      "src/modules/projects/project-staff-service.ts",
      "utf8",
    );
    // 不校验的话，任何有项目人员管理权的员工都能拿已知 userId 构造预览，
    // 而预览会读出对方的姓名、邮件总开关、按场景退订、微信绑定与额度
    const preview = service.slice(
      service.indexOf("export function previewProjectStaffDelivery"),
      service.indexOf("export function updateProjectStaff"),
    );
    expect(preview).toContain("deletedAt: null");
    expect(preview).toContain('"PLATFORM_ADMIN", "PROJECT_MANAGER", "TECHNICIAN"');
    // 角色调整 / 移出的对象是已在本项目里的人，所以范围放宽到本项目成员 ——
    // 但仍然是两个受限来源之一，不能退回成「有 userId 就给看」。
    // 拒绝行为本身另有黑盒断言：tests/projects/project-staff-delivery-override.test.ts
    expect(preview).toContain("projectId_userId");
    expect(preview).toMatch(
      /assertFound\(\s*candidate \?\? member,\s*"该账号不可加入项目"\s*\)/,
    );
  });
});
