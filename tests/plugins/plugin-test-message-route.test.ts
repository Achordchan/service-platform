import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiActor: vi.fn(),
  sendPluginTestMessage: vi.fn(),
}));

vi.mock("@/modules/projects/api-utils", () => ({
  requireApiActor: mocks.requireApiActor,
  readJson: (request: Request) => request.json(),
  routeError: (error: { message?: string; status?: number }) =>
    Response.json(
      { error: { message: error.message ?? "服务器处理失败" } },
      { status: error.status ?? 500 },
    ),
}));
vi.mock("@/modules/plugins/plugin-test-message-service", () => ({
  sendPluginTestMessage: mocks.sendPluginTestMessage,
}));

describe("钉钉插件测试消息接口", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiActor.mockResolvedValue({
      actor: {
        id: "admin-1",
        name: "管理员",
        email: "admin@example.com",
        platformRole: "PLATFORM_ADMIN",
        isPlatformAdmin: true,
        isStaff: true,
      },
    });
    mocks.sendPluginTestMessage.mockResolvedValue({ delivered: true });
  });

  it("连接测试使用空配置显式触发", async () => {
    const { POST } = await import(
      "@/app/api/v1/admin/plugins/[pluginKey]/test-message/route"
    );
    const response = await POST(
      new Request("http://localhost/api/v1/admin/plugins/dingtalk-robot/test-message", {
        method: "POST",
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ pluginKey: "dingtalk-robot" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.sendPluginTestMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: "admin-1" }),
      "dingtalk-robot",
      {},
    );
  });

  it("模板测试只转发受支持的事件和模板内容", async () => {
    const { POST } = await import(
      "@/app/api/v1/admin/plugins/[pluginKey]/test-message/route"
    );
    const input = {
      eventType: "REQUEST_CUSTOMER_REPLIED",
      template: {
        title: "{{customerName}} 有新回复",
        body: "工单：{{requestNumber}}",
      },
    } as const;
    const response = await POST(
      new Request("http://localhost/api/v1/admin/plugins/dingtalk-robot/test-message", {
        method: "POST",
        body: JSON.stringify(input),
      }),
      { params: Promise.resolve({ pluginKey: "dingtalk-robot" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.sendPluginTestMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: "admin-1" }),
      "dingtalk-robot",
      input,
    );
  });
});
