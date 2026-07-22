import { describe, expect, it } from "vitest";
import type { Actor } from "../../src/lib/actor";
import { canAccessCustomerRequestModule } from "../../src/modules/requests/request-context";
import {
  canAttachToRequestMessage,
  canConfirmRequestClosed,
  canManageRequestArchive,
  canManageRequestAssignment,
  canWorkOnRequest,
  canWriteInternalNote,
} from "../../src/modules/requests/request-permissions";

const customer = actor("customer", "CUSTOMER");
const technician = actor("technician", "TECHNICIAN");
const manager = actor("manager", "PROJECT_MANAGER");
const platformAdmin = actor("admin", "PLATFORM_ADMIN");

describe("服务请求权限", () => {
  it("只有平台管理员或项目经理可以分配", () => {
    expect(
      canManageRequestAssignment(platformAdmin, {
        assigneeId: null,
        projectRole: null,
      }),
    ).toBe(true);
    expect(
      canManageRequestAssignment(manager, {
        assigneeId: null,
        projectRole: "PROJECT_MANAGER",
      }),
    ).toBe(true);
    expect(
      canManageRequestAssignment(technician, {
        assigneeId: "technician",
        projectRole: "TECHNICIAN",
      }),
    ).toBe(false);
    expect(
      canManageRequestAssignment(customer, {
        assigneeId: null,
        projectRole: null,
      }),
    ).toBe(false);
  });

  it("处理人、项目经理和平台管理员可以处理请求", () => {
    expect(
      canWorkOnRequest(technician, {
        assigneeId: "technician",
        projectRole: "TECHNICIAN",
      }),
    ).toBe(true);
    expect(
      canWorkOnRequest(manager, {
        assigneeId: null,
        projectRole: "PROJECT_MANAGER",
      }),
    ).toBe(true);
    expect(
      canWorkOnRequest(platformAdmin, {
        assigneeId: null,
        projectRole: null,
      }),
    ).toBe(true);
  });

  it("未被分配的技术人员不能处理请求或写内部备注", () => {
    const context = {
      assigneeId: "other-technician",
      assigneeIds: ["other-technician"],
      projectRole: "TECHNICIAN" as const,
    };
    expect(canWorkOnRequest(technician, context)).toBe(false);
    expect(canWriteInternalNote(technician, context)).toBe(false);
  });

  it("多人分配中的技术人员可以处理请求", () => {
    expect(
      canWorkOnRequest(technician, {
        assigneeId: "other-technician",
        assigneeIds: ["other-technician", "technician"],
        projectRole: "TECHNICIAN",
      }),
    ).toBe(true);
  });

  it("客户不能写内部备注，只能确认关闭", () => {
    const context = { assigneeId: null, projectRole: null };
    expect(canWriteInternalNote(customer, context)).toBe(false);
    expect(canConfirmRequestClosed(customer)).toBe(true);
    expect(canConfirmRequestClosed(manager)).toBe(false);
    expect(canConfirmRequestClosed(platformAdmin)).toBe(false);
  });

  it("只有有权处理请求的后台人员可以归档或恢复", () => {
    const assignedContext = {
      assigneeId: "technician",
      projectRole: "TECHNICIAN" as const,
    };
    expect(canManageRequestArchive(technician, assignedContext)).toBe(true);
    expect(canManageRequestArchive(customer, assignedContext)).toBe(false);
    expect(
      canManageRequestArchive(manager, {
        assigneeId: null,
        projectRole: "PROJECT_MANAGER",
      }),
    ).toBe(true);
    expect(
      canManageRequestArchive(platformAdmin, {
        assigneeId: null,
        projectRole: null,
      }),
    ).toBe(true);
  });

  it("客户受项目服务请求开关限制，工作人员不受影响", () => {
    const disabledRequestModule = {
      project: { customerRequestsEnabled: false },
    };
    expect(
      canAccessCustomerRequestModule(customer, disabledRequestModule),
    ).toBe(false);
    expect(
      canAccessCustomerRequestModule(technician, disabledRequestModule),
    ).toBe(true);
    expect(
      canAccessCustomerRequestModule(customer, {
        project: { customerRequestsEnabled: true },
      }),
    ).toBe(true);
  });

  it("附件只能补充到当前操作者自己发送的消息", () => {
    expect(
      canAttachToRequestMessage(customer, { authorId: customer.id }),
    ).toBe(true);
    expect(
      canAttachToRequestMessage(customer, { authorId: technician.id }),
    ).toBe(false);
    expect(canAttachToRequestMessage(manager, { authorId: null })).toBe(false);
  });
});

function actor(id: string, platformRole: Actor["platformRole"]): Actor {
  return {
    id,
    name: id,
    email: `${id}@example.test`,
    platformRole,
    isPlatformAdmin: platformRole === "PLATFORM_ADMIN",
    isStaff: platformRole !== "CUSTOMER",
  };
}
