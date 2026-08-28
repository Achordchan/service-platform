import { describe, expect, it } from "vitest";
import {
  auditActionLabel,
  auditActionVerb,
  auditResourceLabel,
} from "@/modules/audit/audit-labels";

describe("auditActionLabel", () => {
  it("已知动作码返回完整中文短语（不再暴露原始变量）", () => {
    expect(auditActionLabel("USER_LOGIN")).toBe("登录");
    expect(auditActionLabel("USER_LOGIN_FAILED")).toBe("登录失败");
    expect(auditActionLabel("PROJECT_CREATED")).toBe("创建项目");
    // 「资源+动词」拼不出的语义由整码映射兜住
    expect(auditActionLabel("REQUEST_AUTO_CLAIMED")).toBe("自动认领工单");
    expect(auditActionLabel("REQUEST_INTERNAL_NOTE_CREATED")).toBe(
      "添加内部备注",
    );
  });

  it("未映射的新码：有资源类型时回落到「资源 · 动词」", () => {
    expect(auditActionLabel("WIDGET_CREATED", "Project")).toBe("项目 · 创建");
    expect(auditActionLabel("WIDGET_ARCHIVED", "Milestone")).toBe(
      "里程碑 · 归档",
    );
  });

  it("未映射且无资源类型时回落到动词，再不行回原始码", () => {
    expect(auditActionLabel("WIDGET_CREATED")).toBe("创建");
    expect(auditActionLabel("MYSTERY")).toBe("MYSTERY");
  });

  it("下拉场景（仅动作码、无资源类型）已知码仍是中文", () => {
    expect(auditActionLabel("ATTACHMENT_DOWNLOADED")).toBe("下载附件");
    expect(auditActionLabel("WECHAT_BINDING_REMOVED")).toBe("解除微信绑定");
  });
});

describe("auditActionVerb", () => {
  it("取尾部动词的中文，未知返回 null", () => {
    expect(auditActionVerb("PROJECT_CREATED")).toBe("创建");
    expect(auditActionVerb("REQUEST_STATUS_CHANGED")).toBe("变更");
    expect(auditActionVerb("SOMETHING_WEIRD")).toBeNull();
  });
});

describe("auditResourceLabel", () => {
  it("已知资源返回中文，未知回落原值", () => {
    expect(auditResourceLabel("ServiceRequest")).toBe("服务请求");
    expect(auditResourceLabel("User")).toBe("用户");
    expect(auditResourceLabel("UnknownThing")).toBe("UnknownThing");
  });
});
