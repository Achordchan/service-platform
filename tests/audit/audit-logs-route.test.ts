import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiActor: vi.fn(),
  listAuditLogs: vi.fn(),
  getAuditFacets: vi.fn(),
}));

vi.mock("@/modules/projects/api-utils", () => ({
  requireApiActor: mocks.requireApiActor,
  routeError: (error: { message?: string; status?: number }) =>
    Response.json(
      { error: { message: error.message ?? "服务器处理失败" } },
      { status: error.status ?? 500 },
    ),
}));

vi.mock("@/modules/audit/audit-query", () => ({
  AUDIT_PAGE_SIZE_MAX: 100,
  listAuditLogs: mocks.listAuditLogs,
  getAuditFacets: mocks.getAuditFacets,
}));

async function get(query: string) {
  const { GET } = await import("@/app/api/v1/admin/audit-logs/route");
  const response = await GET(
    new Request(`http://localhost/api/v1/admin/audit-logs?${query}`),
  );
  return { response, body: await response.json() };
}

describe("审计日志接口的筛选项", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiActor.mockResolvedValue({
      actor: {
        id: "admin-1",
        name: "管理员",
        email: "admin@example.test",
        platformRole: "PLATFORM_ADMIN",
        isPlatformAdmin: true,
        isStaff: true,
      },
    });
    mocks.listAuditLogs.mockResolvedValue({
      rows: [],
      total: 0,
      page: 0,
      pageSize: 25,
    });
    mocks.getAuditFacets.mockResolvedValue({
      actions: ["USER_LOGIN", "PROJECT_CREATED"],
      resourceTypes: ["Project"],
      results: ["SUCCESS", "FAILURE"],
    });
  });

  // 部署瞬间浏览器里还挂着旧的 Web bundle，它把这三个字段的每一项当字符串用；
  // 改成对象数组会让那些页面的筛选下拉直接渲染坏，所以中文标签只能另起字段追加。
  it("actions/resourceTypes/results 仍是字符串数组（旧 Web bundle 直接消费）", async () => {
    const { body } = await get("withFacets=1");
    expect(body.data.facets.actions).toEqual(["USER_LOGIN", "PROJECT_CREATED"]);
    expect(body.data.facets.resourceTypes).toEqual(["Project"]);
    expect(body.data.facets.results).toEqual(["SUCCESS", "FAILURE"]);
  });

  it("另外附带中文标签选项，小程序据此渲染，无需复制动作码字典", async () => {
    const { body } = await get("withFacets=1");
    expect(body.data.facets.actionOptions).toEqual([
      { value: "USER_LOGIN", label: "登录" },
      { value: "PROJECT_CREATED", label: "创建项目" },
    ]);
    expect(body.data.facets.resourceTypeOptions).toEqual([
      { value: "Project", label: "项目" },
    ]);
    expect(body.data.facets.resultOptions).toEqual([
      { value: "SUCCESS", label: "成功" },
      { value: "FAILURE", label: "失败" },
    ]);
  });

  it("不带 withFacets 时不查也不下发筛选项", async () => {
    const { body } = await get("page=0");
    expect(mocks.getAuditFacets).not.toHaveBeenCalled();
    expect(body.data.facets).toBeUndefined();
  });
});
