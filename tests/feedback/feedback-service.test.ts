import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/actor";

const mocks = vi.hoisted(() => ({
  feedbackCreate: vi.fn(),
  feedbackUpdate: vi.fn(),
  feedbackCount: vi.fn(),
  feedbackFindMany: vi.fn(),
  feedbackFindFirst: vi.fn(),
  createFeedbackIssue: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/actor", () => ({
  withActorDb: (_actor: Actor, callback: (tx: unknown) => unknown) =>
    callback({
      feedback: {
        create: mocks.feedbackCreate,
        update: mocks.feedbackUpdate,
        count: mocks.feedbackCount,
        findMany: mocks.feedbackFindMany,
        findFirst: mocks.feedbackFindFirst,
      },
    }),
  withSystemDb: (callback: (tx: unknown) => unknown) =>
    callback({
      feedback: {
        update: mocks.feedbackUpdate,
      },
    }),
}));

vi.mock("@/lib/app-version", () => ({
  APP_VERSION: "9.9.9-test",
}));

vi.mock("@/modules/feedback/github-issues", () => ({
  createFeedbackIssue: mocks.createFeedbackIssue,
}));

import {
  buildFeedbackIssueBody,
  listFeedback,
  submitFeedback,
} from "@/modules/feedback/feedback-service";

const staffActor = {
  id: "staff-1",
  name: "员工甲",
  email: "staff@example.com",
  isStaff: true,
  isPlatformAdmin: false,
  platformRole: "PROJECT_MANAGER",
} as unknown as Actor;

const customerActor = {
  id: "customer-1",
  name: "客户乙",
  email: "customer@example.com",
  isStaff: false,
  isPlatformAdmin: false,
  platformRole: "CUSTOMER",
  userAgent: "Mozilla/5.0 (Macintosh) TestUA",
} as unknown as Actor;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.feedbackFindFirst.mockResolvedValue(null);
  mocks.feedbackCreate.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: "fb-1",
      ...data,
    }),
  );
});

describe("submitFeedback", () => {
  it("Web 来源：记录服务端版本与 UA，issue 建成后回写链接", async () => {
    mocks.createFeedbackIssue.mockResolvedValue({
      status: "created",
      number: 42,
      url: "https://github.com/o/r/issues/42",
    });

    const result = await submitFeedback(
      customerActor,
      { title: "标题", content: "内容" },
      "WEB",
    );

    expect(result).toEqual({
      id: "fb-1",
      issueUrl: "https://github.com/o/r/issues/42",
    });

    const createData = mocks.feedbackCreate.mock.calls[0][0].data;
    expect(createData.source).toBe("WEB");
    expect(createData.submitterId).toBe("customer-1");
    expect(createData.appVersion).toBe("9.9.9-test");
    expect(createData.platformInfo).toEqual({
      userAgent: "Mozilla/5.0 (Macintosh) TestUA",
    });

    expect(mocks.createFeedbackIssue).toHaveBeenCalledWith({
      title: "[反馈] 标题",
      body: expect.stringContaining("内容"),
    });
    expect(mocks.feedbackUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "fb-1" },
        data: {
          issueStatus: "CREATED",
          issueNumber: 42,
          issueUrl: "https://github.com/o/r/issues/42",
        },
      }),
    );
  });

  it("小程序来源：记录客户端上报的版本与机型信息", async () => {
    mocks.createFeedbackIssue.mockResolvedValue({
      status: "created",
      number: 1,
      url: "u",
    });

    await submitFeedback(
      customerActor,
      {
        title: "t",
        content: "c",
        miniappRuntime: {
          appVersion: "1.2.3",
          model: "iPhone 15",
          system: "iOS 18.2",
          platform: "ios",
        },
      },
      "MINIAPP",
    );

    const createData = mocks.feedbackCreate.mock.calls[0][0].data;
    expect(createData.source).toBe("MINIAPP");
    expect(createData.appVersion).toBe("1.2.3");
    expect(createData.platformInfo).toEqual({
      appVersion: "1.2.3",
      model: "iPhone 15",
      system: "iOS 18.2",
      platform: "ios",
    });
  });

  it("issue 通道失败：反馈仍算提交成功，回写 FAILED 与原因", async () => {
    mocks.createFeedbackIssue.mockResolvedValue({
      status: "failed",
      reason: "GitHub token 无效或已过期",
    });

    const result = await submitFeedback(
      customerActor,
      { title: "t", content: "c" },
      "WEB",
    );

    expect(result).toEqual({ id: "fb-1", issueUrl: null });
    expect(mocks.feedbackUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          issueStatus: "FAILED",
          issueError: "GitHub token 无效或已过期",
        },
      }),
    );
  });

  it("未配置 token：回写 SKIPPED", async () => {
    mocks.createFeedbackIssue.mockResolvedValue({
      status: "skipped",
      reason: "未配置 GITHUB_FEEDBACK_TOKEN",
    });

    const result = await submitFeedback(
      staffActor,
      { title: "t", content: "c" },
      "WEB",
    );

    expect(result.issueUrl).toBeNull();
    expect(mocks.feedbackUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          issueStatus: "SKIPPED",
          issueError: "未配置 GITHUB_FEEDBACK_TOKEN",
        },
      }),
    );
  });

  it("幂等：同 key 命中已有反馈，直接返回不再建 issue", async () => {
    mocks.feedbackFindFirst.mockResolvedValue({
      id: "fb-existing",
      issueUrl: "https://github.com/o/r/issues/7",
      title: "t",
      content: "c",
    });

    const result = await submitFeedback(
      customerActor,
      { title: "t", content: "c", clientMutationKey: "ma-key-1" },
      "WEB",
    );

    expect(result).toEqual({
      id: "fb-existing",
      issueUrl: "https://github.com/o/r/issues/7",
    });
    expect(mocks.feedbackFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { submitterId: "customer-1", clientMutationKey: "ma-key-1" },
      }),
    );
    expect(mocks.feedbackCreate).not.toHaveBeenCalled();
    expect(mocks.createFeedbackIssue).not.toHaveBeenCalled();
  });

  it("幂等：同 key 但内容已改（失败后编辑却没换 key）→ 409 拒绝", async () => {
    mocks.feedbackFindFirst.mockResolvedValue({
      id: "fb-existing",
      issueUrl: "https://github.com/o/r/issues/7",
      title: "旧标题",
      content: "旧内容",
    });

    await expect(
      submitFeedback(
        customerActor,
        { title: "新标题", content: "新内容", clientMutationKey: "ma-key-1" },
        "WEB",
      ),
    ).rejects.toMatchObject({
      code: "FEEDBACK_MUTATION_PAYLOAD_MISMATCH",
      status: 409,
    });
    expect(mocks.feedbackCreate).not.toHaveBeenCalled();
    expect(mocks.createFeedbackIssue).not.toHaveBeenCalled();
  });

  it("幂等：并发撞唯一约束时兜底返回已有反馈", async () => {
    mocks.feedbackFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "fb-race",
        issueUrl: null,
        title: "t",
        content: "c",
      });
    mocks.feedbackCreate.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    const result = await submitFeedback(
      customerActor,
      { title: "t", content: "c", clientMutationKey: "ma-key-2" },
      "WEB",
    );

    expect(result).toEqual({ id: "fb-race", issueUrl: null });
    expect(mocks.createFeedbackIssue).not.toHaveBeenCalled();
  });

  it("带 key 提交：create 数据带上 clientMutationKey", async () => {
    mocks.createFeedbackIssue.mockResolvedValue({ status: "skipped", reason: "r" });

    await submitFeedback(
      customerActor,
      { title: "t", content: "c", clientMutationKey: "ma-key-3" },
      "WEB",
    );

    const createData = mocks.feedbackCreate.mock.calls[0][0].data;
    expect(createData.clientMutationKey).toBe("ma-key-3");
  });

  it("issue 结果未知：停在 PENDING 只记原因，不标 FAILED", async () => {
    mocks.createFeedbackIssue.mockResolvedValue({
      status: "unknown",
      reason: "GitHub 请求超时，创建结果未知",
    });

    const result = await submitFeedback(
      customerActor,
      { title: "t", content: "c" },
      "WEB",
    );

    expect(result).toEqual({ id: "fb-1", issueUrl: null });
    expect(mocks.feedbackUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { issueError: "GitHub 请求超时，创建结果未知" },
      }),
    );
    // 绝不写 issueStatus：行停在 PENDING，避免有人按「失败」重试建出重复 issue
    for (const call of mocks.feedbackUpdate.mock.calls) {
      expect(call[0].data).not.toHaveProperty("issueStatus");
    }
  });

  it("状态回写失败不致命：提交结果照常返回", async () => {
    mocks.createFeedbackIssue.mockResolvedValue({
      status: "created",
      number: 9,
      url: "https://github.com/o/r/issues/9",
    });
    mocks.feedbackUpdate.mockRejectedValue(new Error("db down"));

    const result = await submitFeedback(
      customerActor,
      { title: "t", content: "c" },
      "WEB",
    );

    expect(result).toEqual({
      id: "fb-1",
      issueUrl: "https://github.com/o/r/issues/9",
    });
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("FEEDBACK_STATUS_WRITE_FAILED"),
    );
  });
});

describe("buildFeedbackIssueBody", () => {
  it("包含环境信息与反馈编号，不含提交人姓名/邮箱", () => {
    const body = buildFeedbackIssueBody({
      content: "按钮点不动",
      source: "MINIAPP",
      appVersion: "1.2.3",
      platformInfo: { model: "iPhone 15", system: "iOS 18.2" },
      id: "fb-abc",
    });

    expect(body).toContain("按钮点不动");
    expect(body).toContain("来源：小程序");
    expect(body).toContain("版本：1.2.3");
    expect(body).toContain("平台：iPhone 15 · iOS 18.2");
    expect(body).toContain("反馈编号：fb-abc");
  });

  it("Web 来源渲染 UA", () => {
    const body = buildFeedbackIssueBody({
      content: "c",
      source: "WEB",
      appVersion: "0.1.0",
      platformInfo: { userAgent: "Mozilla/5.0 Chrome" },
      id: "fb-x",
    });

    expect(body).toContain("来源：Web 端");
    expect(body).toContain("平台：Mozilla/5.0 Chrome");
  });
});

describe("listFeedback", () => {
  it("客户访问直接拒绝", async () => {
    await expect(
      listFeedback(customerActor, { page: 0, pageSize: 25 }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
    expect(mocks.feedbackFindMany).not.toHaveBeenCalled();
  });

  it("员工可见，附中文标签", async () => {
    mocks.feedbackCount.mockResolvedValue(1);
    mocks.feedbackFindMany.mockResolvedValue([
      {
        id: "fb-1",
        title: "标题",
        content: "内容",
        source: "WEB",
        appVersion: "0.1.0",
        platformInfo: { userAgent: "UA" },
        issueStatus: "FAILED",
        issueNumber: null,
        issueUrl: null,
        issueError: "GitHub 服务暂不可用",
        createdAt: new Date("2026-09-04T08:00:00.000Z"),
        submitter: {
          id: "customer-1",
          name: "客户乙",
          email: "customer@example.com",
          platformRole: "CUSTOMER",
        },
      },
    ]);

    const page = await listFeedback(staffActor, { page: 0, pageSize: 25 });

    expect(page.total).toBe(1);
    expect(page.rows[0].sourceLabel).toBe("Web 端");
    expect(page.rows[0].issueStatusLabel).toBe("建 issue 失败");
    expect(page.rows[0].submitter?.name).toBe("客户乙");
    expect(page.rows[0].createdAt).toBe("2026-09-04T08:00:00.000Z");
  });
});
