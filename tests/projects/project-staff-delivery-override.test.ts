import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/actor";

const mocks = vi.hoisted(() => ({
  tx: null as Record<string, unknown> | null,
  dispatchProjectStaffActivity: vi.fn(),
  previewProjectStaffRecipients: vi.fn(async () => []),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/actor", () => ({
  withActorDb: (_actor: Actor, callback: (tx: unknown) => unknown) =>
    callback(mocks.tx),
}));

vi.mock("@/modules/audit/audit-service", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("@/modules/notifications/notification-service", () => ({
  dispatchProjectStaffActivity: mocks.dispatchProjectStaffActivity,
  publishDetachedProjectChange: vi.fn(),
  publishProjectChange: vi.fn(),
  previewProjectStaffRecipients: mocks.previewProjectStaffRecipients,
}));

vi.mock("@/modules/projects/project-access", () => ({
  assertCanManageProjectStaff: vi.fn(),
  assertCanViewProject: vi.fn(),
}));

import {
  previewProjectStaffDelivery,
  removeProjectStaff,
  updateProjectStaff,
} from "@/modules/projects/project-staff-service";

const admin: Actor = {
  id: "admin-1",
  name: "管理员",
  email: "admin@example.test",
  platformRole: "PLATFORM_ADMIN",
  isPlatformAdmin: true,
  isStaff: true,
};

const override = { notification: false as const, excludeUserIds: ["tech-1"] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tx = null;
});

describe("项目人员变更的送达覆盖", () => {
  it("调整角色时把本次覆盖交给通知派发", async () => {
    mocks.tx = {
      projectStaff: {
        findFirst: vi.fn(async () => ({
          id: "staff-1",
          userId: "tech-1",
          role: "TECHNICIAN",
          project: { customerSpaceId: "space-1", title: "官网升级" },
          user: { platformRole: "PLATFORM_ADMIN", deletedAt: null },
        })),
        update: vi.fn(async () => ({
          id: "staff-1",
          role: "PROJECT_MANAGER",
          user: { id: "tech-1" },
        })),
      },
    };

    await updateProjectStaff(
      admin,
      "project-1",
      "staff-1",
      { role: "PROJECT_MANAGER" },
      override,
    );

    expect(mocks.dispatchProjectStaffActivity).toHaveBeenCalledOnce();
    expect(mocks.dispatchProjectStaffActivity.mock.calls[0]?.[2]).toMatchObject({
      change: "PROJECT_STAFF_SELF_UPDATED",
      recipientUserId: "tech-1",
      deliveryOverride: override,
    });
  });

  it("移出项目时把本次覆盖交给通知派发", async () => {
    mocks.tx = {
      projectStaff: {
        findFirst: vi.fn(async () => ({
          id: "staff-1",
          userId: "tech-1",
          role: "TECHNICIAN",
          project: { customerSpaceId: "space-1", title: "官网升级" },
        })),
        delete: vi.fn(async () => ({ id: "staff-1" })),
      },
      serviceRequest: { findMany: vi.fn(async () => []), update: vi.fn() },
      requestAssignee: { deleteMany: vi.fn(), findFirst: vi.fn() },
    };

    await removeProjectStaff(admin, "project-1", "staff-1", override);

    expect(mocks.dispatchProjectStaffActivity).toHaveBeenCalledOnce();
    expect(mocks.dispatchProjectStaffActivity.mock.calls[0]?.[2]).toMatchObject({
      change: "PROJECT_STAFF_SELF_REMOVED",
      recipientUserId: "tech-1",
      deliveryOverride: override,
    });
  });

  it("已在项目里的人即使平台角色已不可分配也能预览", async () => {
    // 成员的 platformRole 事后被降成客户：他仍然要能被调整角色 / 移出，
    // 只按「可加入本项目的内部人员」判会把预览挡在门外，做得了却看不见。
    mocks.tx = {
      project: { findUnique: vi.fn(async () => ({ customerSpaceId: "space-1" })) },
      user: { findFirst: vi.fn(async () => null) },
      projectStaff: { findUnique: vi.fn(async () => ({ id: "staff-1" })) },
    };

    await expect(
      previewProjectStaffDelivery(admin, "project-1", "tech-1"),
    ).resolves.toEqual([]);
    expect(mocks.previewProjectStaffRecipients).toHaveBeenCalledOnce();
  });

  it("既不是候选也不在项目里的账号仍然拒绝预览", async () => {
    mocks.tx = {
      project: { findUnique: vi.fn(async () => ({ customerSpaceId: "space-1" })) },
      user: { findFirst: vi.fn(async () => null) },
      projectStaff: { findUnique: vi.fn(async () => null) },
    };

    await expect(
      previewProjectStaffDelivery(admin, "project-1", "outsider-1"),
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.previewProjectStaffRecipients).not.toHaveBeenCalled();
  });
});
