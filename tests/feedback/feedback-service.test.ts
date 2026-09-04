import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/actor";

const mocks = vi.hoisted(() => ({
  feedbackCreate: vi.fn(),
  feedbackUpdate: vi.fn(),
  feedbackCount: vi.fn(),
  feedbackFindMany: vi.fn(),
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
