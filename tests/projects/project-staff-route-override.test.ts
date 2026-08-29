import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateProjectStaff: vi.fn(),
  removeProjectStaff: vi.fn(),
}));

vi.mock("@/modules/projects/project-staff-service", () => ({
  updateProjectStaff: mocks.updateProjectStaff,
  removeProjectStaff: mocks.removeProjectStaff,
}));

vi.mock("@/modules/http/api-actor", () => ({
  resolveApiActor: vi.fn(async () => ({
    actor: {
      id: "admin-1",
      name: "管理员",
      email: "admin@example.test",
      platformRole: "PLATFORM_ADMIN",
      isPlatformAdmin: true,
      isStaff: true,
    },
  })),
}));

vi.mock("server-only", () => ({}));

const params = Promise.resolve({
  projectId: "project-1",
  projectStaffId: "staff-1",
});

const override = { notification: false, excludeUserIds: ["tech-1"] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateProjectStaff.mockResolvedValue({ id: "staff-1" });
  mocks.removeProjectStaff.mockResolvedValue(undefined);
});

describe("项目人员接口的送达覆盖透传", () => {
  it("PATCH 把覆盖交给服务层，且不会把它混进 Prisma 更新字段", async () => {
    const { PATCH } = await import(
      "@/app/api/v1/projects/[projectId]/staff/[projectStaffId]/route"
    );

    const response = await PATCH(
      new Request("http://localhost/staff/staff-1", {
        method: "PATCH",
        body: JSON.stringify({ role: "TECHNICIAN", deliveryOverride: override }),
      }),
      { params },
    );

    expect(response.status).toBe(200);
    expect(mocks.updateProjectStaff).toHaveBeenCalledWith(
      expect.objectContaining({ id: "admin-1" }),
      "project-1",
      "staff-1",
      { role: "TECHNICIAN" },
      override,
    );
  });

  it("DELETE 带覆盖时透传", async () => {
    const { DELETE } = await import(
      "@/app/api/v1/projects/[projectId]/staff/[projectStaffId]/route"
    );

    const response = await DELETE(
      new Request("http://localhost/staff/staff-1", {
        method: "DELETE",
        body: JSON.stringify({ deliveryOverride: override }),
      }),
      { params },
    );

    expect(response.status).toBe(204);
    expect(mocks.removeProjectStaff).toHaveBeenCalledWith(
      expect.objectContaining({ id: "admin-1" }),
      "project-1",
      "staff-1",
      override,
    );
  });

  it("DELETE 不带 body 仍按原样移出", async () => {
    const { DELETE } = await import(
      "@/app/api/v1/projects/[projectId]/staff/[projectStaffId]/route"
    );

    const response = await DELETE(
      new Request("http://localhost/staff/staff-1", { method: "DELETE" }),
      { params },
    );

    expect(response.status).toBe(204);
    expect(mocks.removeProjectStaff).toHaveBeenCalledWith(
      expect.objectContaining({ id: "admin-1" }),
      "project-1",
      "staff-1",
      undefined,
    );
  });
});
