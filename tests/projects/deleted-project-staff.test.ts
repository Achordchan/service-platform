import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/actor";

const mocks = vi.hoisted(() => ({
  tx: null as Record<string, unknown> | null,
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/actor", () => ({
  withActorDb: (_actor: Actor, callback: (tx: unknown) => unknown) =>
    callback(mocks.tx),
}));

vi.mock("@/modules/authorization/role-permission-policy", () => ({
  hasRolePermission: vi.fn(() => true),
}));

vi.mock("@/modules/audit/audit-service", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("@/modules/attachments/private-storage", () => ({
  removePrivateFile: vi.fn(),
}));

vi.mock("@/modules/deletion/deletion-service", () => ({
  assertDeletionAllowedInTx: vi.fn(),
}));

vi.mock("@/modules/notifications/notification-service", () => ({
  dispatchProjectCreatedActivity: vi.fn(),
  publishDetachedProjectChange: vi.fn(),
  publishProjectChange: vi.fn(),
  publishProjectDeleted: vi.fn(),
}));

vi.mock("@/modules/projects/project-access", () => ({
  assertCanManageProjectStaff: vi.fn(),
  assertCanViewProject: vi.fn(),
}));

vi.mock("@/modules/projects/project-summary-query", () => ({
  hydrateProjectSummaries: vi.fn(),
  projectBaseSelect: {},
}));

vi.mock("@/modules/projects/project-detail-query", () => ({
  loadProjectDetail: vi.fn(),
}));

vi.mock("@/modules/projects/project-customer-recipient-query", () => ({
  listProjectCustomerUserIds: vi.fn(),
}));

vi.mock("@/modules/plugins/plugin-installation-service", () => ({
  ensurePluginInstallations: vi.fn(),
}));

vi.mock("@/modules/plugins/plugin-registry", () => ({
  getRegisteredPlugin: vi.fn(),
  listRegisteredExternalConnectors: vi.fn(() => []),
}));

import { addProjectStaff } from "@/modules/projects/project-staff-service";
import { createProject } from "@/modules/projects/project-service";

const admin: Actor = {
  id: "admin-1",
  name: "管理员",
  email: "admin@example.test",
  platformRole: "PLATFORM_ADMIN",
  isPlatformAdmin: true,
  isStaff: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tx = null;
});

describe("已删除人员的项目权限边界", () => {
  it("创建项目时拒绝把已删除账号设为项目负责人", async () => {
    const projectStaffCreate = vi.fn();
    mocks.tx = {
      serviceType: {
        findUnique: vi.fn(async () => ({ id: "service-type-1", active: true })),
      },
      customerSpace: {
        findFirst: vi.fn(async () => ({ id: "space-1", status: "ACTIVE" })),
      },
      project: {
        create: vi.fn(async () => ({
          id: "project-1",
          customerSpaceId: "space-1",
        })),
      },
      user: {
        findUnique: vi.fn(async () => ({
          id: "deleted-manager",
          platformRole: "PROJECT_MANAGER",
          deletedAt: new Date(),
        })),
      },
      projectStaff: { create: projectStaffCreate },
    };

    await expect(
      createProject(admin, {
        title: "测试项目",
        serviceTypeId: "service-type-1",
        customerSpaceId: "space-1",
        managerUserIds: ["deleted-manager"],
      }),
    ).rejects.toMatchObject({ code: "USER_NOT_FOUND", status: 404 });
    expect(projectStaffCreate).not.toHaveBeenCalled();
  });

  it("项目成员接口拒绝重新添加已删除账号", async () => {
    const projectStaffCreate = vi.fn();
    mocks.tx = {
      project: {
        findUnique: vi.fn(async () => ({
          id: "project-1",
          customerSpaceId: "space-1",
        })),
      },
      user: {
        findUnique: vi.fn(async () => ({
          id: "deleted-technician",
          platformRole: "TECHNICIAN",
          deletedAt: new Date(),
        })),
      },
      projectStaff: {
        findUnique: vi.fn(async () => null),
        create: projectStaffCreate,
      },
    };

    await expect(
      addProjectStaff(admin, "project-1", {
        userId: "deleted-technician",
        role: "TECHNICIAN",
      }),
    ).rejects.toMatchObject({ code: "USER_NOT_FOUND", status: 404 });
    expect(projectStaffCreate).not.toHaveBeenCalled();
  });
});
