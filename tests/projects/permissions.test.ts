import { describe, expect, it } from "vitest";
import {
  canContributeToProject,
  canManageProjectDelivery,
  canViewContent,
  canViewProject,
  type ProjectAccess,
  type ProjectPermissionActor,
} from "../../src/modules/projects/permissions";

const admin: ProjectPermissionActor = {
  id: "admin",
  isPlatformAdmin: true,
  isStaff: true,
};
const projectManager: ProjectPermissionActor = {
  id: "pm",
  isPlatformAdmin: false,
  isStaff: true,
};
const technician: ProjectPermissionActor = {
  id: "tech",
  isPlatformAdmin: false,
  isStaff: true,
};
const customer: ProjectPermissionActor = {
  id: "customer",
  isPlatformAdmin: false,
  isStaff: false,
};

function access(
  projectRole: ProjectAccess["projectRole"],
  isCustomerSpaceMember = false,
): ProjectAccess {
  return { projectRole, isCustomerSpaceMember };
}

describe("项目权限", () => {
  it("管理员可以查看和管理任意项目", () => {
    expect(canViewProject(admin, access(null))).toBe(true);
    expect(canManageProjectDelivery(admin, access(null))).toBe(true);
  });

  it("只有已分配的项目负责人可以管理里程碑和进度", () => {
    expect(
      canManageProjectDelivery(projectManager, access("PROJECT_MANAGER")),
    ).toBe(true);
    expect(
      canManageProjectDelivery(technician, access("TECHNICIAN")),
    ).toBe(false);
    expect(canManageProjectDelivery(projectManager, access(null))).toBe(false);
  });

  it("技术人员只能在已分配项目中参与内部协作", () => {
    expect(canContributeToProject(technician, access("TECHNICIAN"))).toBe(
      true,
    );
    expect(canContributeToProject(technician, access(null))).toBe(false);
  });

  it("客户只能查看所属客户空间的项目", () => {
    expect(canViewProject(customer, access(null, true))).toBe(true);
    expect(canViewProject(customer, access(null, false))).toBe(false);
  });

  it("客户不能查看 INTERNAL 内容，已分配内部人员可以查看", () => {
    expect(
      canViewContent(customer, access(null, true), "CUSTOMER_VISIBLE"),
    ).toBe(true);
    expect(canViewContent(customer, access(null, true), "INTERNAL")).toBe(
      false,
    );
    expect(
      canViewContent(technician, access("TECHNICIAN"), "INTERNAL"),
    ).toBe(true);
  });
});
