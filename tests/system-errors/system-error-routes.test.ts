import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as list } from "@/app/api/v1/admin/system-errors/route";
import { GET as detail } from "@/app/api/v1/admin/system-errors/[referenceId]/route";
import { GET as exportErrors } from "@/app/api/v1/admin/system-errors/export/route";

const mocks = vi.hoisted(() => ({
  requireApiActor: vi.fn(),
  listSystemErrors: vi.fn(),
  getSystemErrorFacets: vi.fn(),
  getSystemErrorDetail: vi.fn(),
  exportSystemErrors: vi.fn(),
  writeAuditLog: vi.fn(),
}));

vi.mock("@/modules/projects/api-utils", () => ({
  requireApiActor: mocks.requireApiActor,
  routeError: (error: { message?: string; status?: number; name?: string }) =>
    Response.json(
      { error: { message: error.message ?? "服务器处理失败", name: error.name } },
      { status: error.status ?? (error.name === "ZodError" ? 422 : 500) },
    ),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/actor", () => ({
  withActorDb: (_actor: unknown, callback: (tx: unknown) => unknown) => callback({}),
}));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/system-errors/system-error-query", async () => {
  const limits = await import("@/modules/system-errors/system-error-limits");
  return {
    ...limits,
    listSystemErrors: mocks.listSystemErrors,
    getSystemErrorFacets: mocks.getSystemErrorFacets,
    getSystemErrorDetail: mocks.getSystemErrorDetail,
    exportSystemErrors: mocks.exportSystemErrors,
  };
});

const admin = {
  id: "admin-1",
  name: "管理员",
  email: "admin@example.test",
  platformRole: "PLATFORM_ADMIN",
  isPlatformAdmin: true,
  isStaff: true,
};

const row = {
  id: "1",
  referenceId: "err_abc",
  category: "DATABASE_PERMISSION",
  errorName: "Error",
  source: "project-api",
  operation: "x.y",
  requestMethod: "POST",
  requestPath: "/api/v1/x",
  actorType: "STAFF",
  actorId: "u1",
  actorName: "张三",
  occurrenceCount: 1,
  summary: "s",
  createdAt: "2026-10-06T00:00:00.000Z",
  details: { category: "DATABASE_PERMISSION" },
  context: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireApiActor.mockResolvedValue({ actor: admin });
  mocks.listSystemErrors.mockResolvedValue({ rows: [row], total: 1, page: 0, pageSize: 25 });
  mocks.getSystemErrorFacets.mockResolvedValue({
    categories: ["DATABASE_PERMISSION"],
    sources: ["project-api"],
    operations: ["x.y"],
  });
  mocks.exportSystemErrors.mockResolvedValue({ rows: [row], total: 1, truncated: false });
});

describe("系统报错接口", () => {
  it("列表附带中文分类标签和筛选项，空串参数视为没传", async () => {
    const response = await list(
      new Request("http://localhost/api/v1/admin/system-errors?category=&search=err_abc&withFacets=1"),
    );
    const body = await response.json();

    expect(mocks.listSystemErrors).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ search: "err_abc", page: 0, pageSize: 25 }),
    );
    expect(mocks.listSystemErrors.mock.calls[0][1].category).toBeUndefined();
    expect(body.data.rows[0]).toMatchObject({
      categoryLabel: "数据库权限",
      actorTypeLabel: "员工",
    });
    expect(body.data.facets.categoryOptions).toEqual([
      { value: "DATABASE_PERMISSION", label: "数据库权限" },
    ]);
  });

  it("未登录直接返回认证失败，不查库", async () => {
    mocks.requireApiActor.mockResolvedValue({
      response: Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 }),
    });

    const response = await list(new Request("http://localhost/api/v1/admin/system-errors"));

    expect(response.status).toBe(401);
    expect(mocks.listSystemErrors).not.toHaveBeenCalled();
  });

  it("详情找不到时返回 404，找到时带排查提示", async () => {
    mocks.getSystemErrorDetail.mockResolvedValueOnce(null);
    const missing = await detail(new Request("http://localhost/x"), {
      params: Promise.resolve({ referenceId: "err_missing" }),
    });
    expect(missing.status).toBe(404);

    mocks.getSystemErrorDetail.mockResolvedValueOnce({
      ...row,
      related: [row],
      relatedWindowHours: 24,
    });
    const found = await detail(new Request("http://localhost/x"), {
      params: Promise.resolve({ referenceId: "err_abc" }),
    });
    const body = await found.json();
    expect(body.data.categoryHint).toContain("RLS");
    expect(body.data.related[0].categoryLabel).toBe("数据库权限");
  });

  it("导出 CSV 带下载头并写审计；JSON 不含操作者姓名", async () => {
    const csv = await exportErrors(
      new Request("http://localhost/api/v1/admin/system-errors/export?format=csv&category=DATABASE_PERMISSION"),
    );
    expect(csv.headers.get("Content-Type")).toContain("text/csv");
    expect(csv.headers.get("Content-Disposition")).toMatch(/attachment; filename="system-errors-.*\.csv"/);
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      admin,
      expect.objectContaining({
        action: "SYSTEM_ERROR_LOG_EXPORTED",
        resourceType: "SystemErrorLog",
        metadata: expect.objectContaining({
          format: "csv",
          rowCount: 1,
          filters: { category: "DATABASE_PERMISSION" },
        }),
      }),
    );

    const json = await exportErrors(
      new Request("http://localhost/api/v1/admin/system-errors/export"),
    );
    const text = await json.text();
    expect(JSON.parse(text).rows).toHaveLength(1);
    expect(text).not.toContain("张三");
  });

  it("非平台管理员不能导出", async () => {
    mocks.requireApiActor.mockResolvedValue({
      actor: { ...admin, platformRole: "TECHNICIAN", isPlatformAdmin: false },
    });

    const response = await exportErrors(
      new Request("http://localhost/api/v1/admin/system-errors/export"),
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(mocks.exportSystemErrors).not.toHaveBeenCalled();
  });

  it("不支持的导出格式被拒绝", async () => {
    const response = await exportErrors(
      new Request("http://localhost/api/v1/admin/system-errors/export?format=xml"),
    );

    expect(response.status).toBe(422);
    expect(mocks.exportSystemErrors).not.toHaveBeenCalled();
  });
});
