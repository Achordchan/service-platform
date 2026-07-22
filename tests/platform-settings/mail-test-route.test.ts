import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiActor: vi.fn(),
  createMailMessageInTx: vi.fn(),
  processMailMessage: vi.fn(),
  getPublicAppUrl: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/projects/api-utils", () => ({
  requireApiActor: mocks.requireApiActor,
  readJson: (request: Request) => request.json(),
  routeError: (error: { code?: string; message?: string; status?: number }) =>
    Response.json(
      {
        error: {
          code: error.code ?? "INTERNAL_ERROR",
          message: error.message ?? "服务器处理失败",
        },
      },
      { status: error.status ?? 500 },
    ),
}));
vi.mock("@/lib/jobs", () => ({
  createMailMessageInTx: mocks.createMailMessageInTx,
}));
vi.mock("@/lib/mail", () => ({
  processMailMessage: mocks.processMailMessage,
}));
vi.mock("@/lib/system-db", () => ({
  withSystemDb: (callback: (tx: object) => unknown) => callback({}),
}));
vi.mock("@/modules/platform-settings/mail-settings-runtime", () => ({
  getPublicAppUrl: mocks.getPublicAppUrl,
}));

describe("管理员测试邮件接口", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPublicAppUrl.mockResolvedValue("https://example.com");
  });

  it("拒绝非平台管理员使用邮件通道", async () => {
    mocks.requireApiActor.mockResolvedValue({
      actor: {
        id: "customer_1",
        email: "customer@example.com",
        isPlatformAdmin: false,
      },
    });
    const { POST } = await import("@/app/api/v1/admin/mail/test/route");

    const response = await POST(
      new Request("http://localhost/api/v1/admin/mail/test", {
        method: "POST",
        body: JSON.stringify({ to: "target@example.com", deliveryMode: "SMTP" }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "FORBIDDEN" },
    });
    expect(mocks.createMailMessageInTx).not.toHaveBeenCalled();
    expect(mocks.processMailMessage).not.toHaveBeenCalled();
  });

  it("同步发送被其他任务抢占时不返回假成功", async () => {
    mocks.requireApiActor.mockResolvedValue({
      actor: {
        id: "admin_1",
        email: "admin@example.com",
        isPlatformAdmin: true,
      },
    });
    mocks.createMailMessageInTx.mockResolvedValue({
      id: "mail_1",
      deliveryMode: "SMTP",
    });
    mocks.processMailMessage.mockResolvedValue({ id: "mail_1", skipped: true });
    const { POST } = await import("@/app/api/v1/admin/mail/test/route");

    const response = await POST(
      new Request("http://localhost/api/v1/admin/mail/test", {
        method: "POST",
        body: JSON.stringify({ to: "target@example.com", deliveryMode: "SMTP" }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "MAIL_TEST_DELIVERY_BUSY" },
    });
    expect(mocks.createMailMessageInTx).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        sourceType: "ADMIN_TEST_EMAIL",
        sendAfter: expect.any(Date),
      }),
    );
  });
});
