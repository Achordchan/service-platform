import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/actor";

const mocks = vi.hoisted(() => ({
  milestoneCommentFindFirst: vi.fn(),
  milestoneCommentFindMany: vi.fn(),
  milestoneCommentCreate: vi.fn(),
  milestoneCommentUpdate: vi.fn(),
  milestoneCommentDelete: vi.fn(),
  milestoneFindFirst: vi.fn(),
  queryRaw: vi.fn(),
  removePrivateFile: vi.fn(),
  writeAuditLog: vi.fn(),
  publishProjectChange: vi.fn(),
  isContentRiskStateRevoked: vi.fn(() => false),
  customerFeatures: {
    milestones: true,
    progress: false,
  },
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/actor", () => ({
  withActorDb: (_actor: Actor, callback: (tx: unknown) => unknown) =>
    callback({
      $queryRaw: mocks.queryRaw,
      milestoneComment: {
        findFirst: mocks.milestoneCommentFindFirst,
        findMany: mocks.milestoneCommentFindMany,
        create: mocks.milestoneCommentCreate,
        update: mocks.milestoneCommentUpdate,
        delete: mocks.milestoneCommentDelete,
      },
      milestone: { findFirst: mocks.milestoneFindFirst },
    }),
}));

vi.mock("@/modules/attachments/private-storage", () => ({
  removePrivateFile: mocks.removePrivateFile,
}));

vi.mock("@/modules/audit/audit-service", () => ({
  writeAuditLog: mocks.writeAuditLog,
}));

vi.mock("@/modules/notifications/notification-service", () => ({
  dispatchProjectActivity: vi.fn(async () => ({ feedback: { skipped: [] } })),
  publishProjectChange: mocks.publishProjectChange,
  previewProjectActivityRecipients: vi.fn(),
}));

vi.mock("@/modules/projects/project-access", () => ({
  // access 按调用者身份给：员工有项目角色，客户作者走空间成员身份
  assertCanViewProject: vi.fn(
    async (_tx: unknown, actor: Actor) => ({
      customerSpaceId: "space-1",
      customerFeatures: mocks.customerFeatures,
      access: actor.isStaff
        ? { isCustomerSpaceMember: false, projectRole: "PROJECT_MANAGER" }
        : { isCustomerSpaceMember: true, projectRole: null },
    }),
  ),
  assertCanCommentOnProjectUpdate: vi.fn(),
}));

vi.mock("@/modules/plugins/content-risk-service", () => ({
  createContentRiskReview: vi.fn(async () => null),
  enforceActorPublicContentRules: vi.fn(),
}));

vi.mock("@/modules/plugins/content-risk-view-service", () => ({
  loadContentRiskPageState: vi.fn(async () => ({
    enabled: false,
    states: new Map(),
  })),
  isContentRiskStateRevoked: mocks.isContentRiskStateRevoked,
  contentRiskStatusFor: vi.fn(() => null),
}));

import {
  createMilestoneComment,
  deleteMilestoneComment,
  updateMilestoneComment,
} from "@/modules/projects/milestone-comment-service";

const staffActor = {
  id: "staff-1",
  name: "员工甲",
  isStaff: true,
  isPlatformAdmin: false,
  platformRole: "PROJECT_MANAGER",
} as unknown as Actor;

const authorActor = {
  id: "author-1",
  name: "作者",
  isStaff: false,
  isPlatformAdmin: false,
  platformRole: "CUSTOMER",
} as unknown as Actor;

const adminActor = {
  id: "admin-1",
  name: "管理员",
  isStaff: true,
  isPlatformAdmin: true,
  platformRole: "PLATFORM_ADMIN",
} as unknown as Actor;

const author = { id: "author-1", name: "作者" };

function mockMilestoneVisible() {
  mocks.milestoneFindFirst.mockResolvedValue({ id: "milestone-1" });
}

describe("milestone comment service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isContentRiskStateRevoked.mockReturnValue(false);
    mocks.customerFeatures.milestones = true;
    mocks.customerFeatures.progress = false;
    mocks.queryRaw.mockResolvedValue([{ id: "comment-1" }]);
    mockMilestoneVisible();
  });

  it("作者本人可以编辑自己的里程碑评论", async () => {
    mocks.milestoneCommentFindFirst.mockResolvedValue({
      id: "comment-1",
      body: "<p>旧内容</p>",
      authorId: "author-1",
      visibility: "CUSTOMER_VISIBLE",
    });
    mocks.milestoneCommentUpdate.mockResolvedValue({
      id: "comment-1",
      body: "<p>新内容</p>",
      authorId: "author-1",
      visibility: "CUSTOMER_VISIBLE",
      author,
    });

    const updated = await updateMilestoneComment(
      authorActor,
      "project-1",
      "milestone-1",
      "comment-1",
      { body: "<p>新内容</p>" },
    );
    expect(updated.id).toBe("comment-1");
    expect(mocks.milestoneCommentUpdate).toHaveBeenCalled();
  });

  it("平台管理员也不能编辑别人的里程碑评论", async () => {
    mocks.milestoneCommentFindFirst.mockResolvedValue({
      id: "comment-1",
      body: "<p>客户的话</p>",
      authorId: "author-1",
      visibility: "CUSTOMER_VISIBLE",
    });

    await expect(
      updateMilestoneComment(
        adminActor,
        "project-1",
        "milestone-1",
        "comment-1",
        { body: "<p>替客户改写</p>" },
      ),
    ).rejects.toMatchObject({ message: "只能修改自己发布的评论" });
    expect(mocks.milestoneCommentUpdate).not.toHaveBeenCalled();
  });

  it("非作者的普通员工同样不能编辑", async () => {
    mocks.milestoneCommentFindFirst.mockResolvedValue({
      id: "comment-1",
      body: "<p>客户的话</p>",
      authorId: "author-1",
      visibility: "CUSTOMER_VISIBLE",
    });

    await expect(
      updateMilestoneComment(
        staffActor,
        "project-1",
        "milestone-1",
        "comment-1",
        { body: "<p>员工改写</p>" },
      ),
    ).rejects.toMatchObject({ message: "只能修改自己发布的评论" });
  });

  it("评论收紧为内部时仍通知原客户受众刷新", async () => {
    mocks.milestoneCommentFindFirst.mockResolvedValue({
      id: "comment-1",
      body: "<p>原客户可见内容</p>",
      authorId: "staff-1",
      visibility: "CUSTOMER_VISIBLE",
    });
    mocks.milestoneCommentUpdate.mockResolvedValue({
      id: "comment-1",
      body: "<p>改为内部</p>",
      authorId: "staff-1",
      visibility: "INTERNAL",
      author: { id: "staff-1", name: "员工甲" },
    });

    await updateMilestoneComment(
      staffActor,
      "project-1",
      "milestone-1",
      "comment-1",
      { body: "<p>改为内部</p>", visibility: "INTERNAL" },
    );

    expect(mocks.publishProjectChange).toHaveBeenCalledWith(
      expect.anything(),
      staffActor,
      expect.objectContaining({
        change: "MILESTONE_COMMENT_UPDATED",
        visibility: "CUSTOMER_VISIBLE",
      }),
    );
  });

  it("公开内容预检后评论被并发修改时拒绝写入", async () => {
    mocks.milestoneCommentFindFirst
      .mockResolvedValueOnce({
        body: "<p>已审核的内部正文</p>",
        visibility: "INTERNAL",
      })
      .mockResolvedValueOnce({
        id: "comment-1",
        body: "<p>并发写入的未审核正文</p>",
        authorId: "staff-1",
        visibility: "INTERNAL",
      });

    await expect(
      updateMilestoneComment(
        staffActor,
        "project-1",
        "milestone-1",
        "comment-1",
        { visibility: "CUSTOMER_VISIBLE" },
      ),
    ).rejects.toMatchObject({
      code: "MILESTONE_COMMENT_CONFLICT",
      status: 409,
      message: "评论已更新，请刷新后重试",
    });
    expect(mocks.milestoneCommentUpdate).not.toHaveBeenCalled();
  });

  it("客户不能创建内部可见的里程碑评论", async () => {
    mocks.milestoneCommentCreate.mockResolvedValue({
      id: "comment-1",
      body: "<p>hi</p>",
      visibility: "CUSTOMER_VISIBLE",
      author,
    });

    await expect(
      createMilestoneComment(authorActor, "project-1", "milestone-1", {
        body: "<p>hi</p>",
        visibility: "INTERNAL",
      }),
    ).rejects.toMatchObject({ message: "客户不能创建内部评论" });
  });

  it("客户发表的里程碑评论一律落成 CUSTOMER_VISIBLE", async () => {
    mocks.milestoneCommentCreate.mockResolvedValue({
      id: "comment-1",
      body: "<p>hi</p>",
      visibility: "CUSTOMER_VISIBLE",
      author,
    });

    await createMilestoneComment(authorActor, "project-1", "milestone-1", {
      body: "<p>hi</p>",
    });
    expect(mocks.milestoneCommentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          visibility: "CUSTOMER_VISIBLE",
          authorId: "author-1",
        }),
      }),
    );
  });

  it("仅开启进度时客户仍可以发表里程碑评论", async () => {
    mocks.customerFeatures.milestones = false;
    mocks.customerFeatures.progress = true;
    mocks.milestoneCommentCreate.mockResolvedValue({
      id: "comment-1",
      body: "<p>进度里程碑留言</p>",
      visibility: "CUSTOMER_VISIBLE",
      author,
    });

    await createMilestoneComment(authorActor, "project-1", "milestone-1", {
      body: "<p>进度里程碑留言</p>",
    });

    expect(mocks.milestoneCommentCreate).toHaveBeenCalled();
  });

  it("里程碑与进度都关闭时客户看不到评论功能", async () => {
    mocks.customerFeatures.milestones = false;
    mocks.customerFeatures.progress = false;

    await expect(
      createMilestoneComment(authorActor, "project-1", "milestone-1", {
        body: "<p>不应写入</p>",
      }),
    ).rejects.toMatchObject({ message: "项目功能未开放", status: 404 });
    expect(mocks.milestoneCommentCreate).not.toHaveBeenCalled();
  });

  it("父里程碑已撤回时服务端拒绝新评论", async () => {
    mocks.isContentRiskStateRevoked.mockReturnValue(true);

    await expect(
      createMilestoneComment(authorActor, "project-1", "milestone-1", {
        body: "<p>不应写入</p>",
      }),
    ).rejects.toMatchObject({ message: "里程碑已撤回，不能继续评论" });
    expect(mocks.milestoneCommentCreate).not.toHaveBeenCalled();
  });

  it("作者本人可以删除自己的里程碑评论", async () => {
    mocks.milestoneCommentFindFirst.mockResolvedValue({
      id: "comment-1",
      body: "<p>我的评论</p>",
      authorId: "author-1",
      visibility: "CUSTOMER_VISIBLE",
      attachments: [],
    });
    mocks.milestoneCommentDelete.mockResolvedValue({ id: "comment-1" });

    const result = await deleteMilestoneComment(
      authorActor,
      "project-1",
      "milestone-1",
      "comment-1",
    );
    expect(result).toEqual({ deleted: true });
    expect(mocks.milestoneCommentDelete).toHaveBeenCalledWith({
      where: { id: "comment-1" },
    });
  });

  it("删除评论时连 storage/preview 文件一起清理", async () => {
    mocks.milestoneCommentFindFirst.mockResolvedValue({
      id: "comment-1",
      body: "<p>我的评论</p>",
      authorId: "author-1",
      visibility: "CUSTOMER_VISIBLE",
      attachments: [
        { storageKey: "files/a", previewStorageKey: "files/a-preview" },
      ],
    });
    mocks.milestoneCommentDelete.mockResolvedValue({ id: "comment-1" });

    await deleteMilestoneComment(
      authorActor,
      "project-1",
      "milestone-1",
      "comment-1",
    );
    expect(mocks.removePrivateFile).toHaveBeenCalledTimes(2);
    expect(mocks.removePrivateFile).toHaveBeenNthCalledWith(1, "files/a");
    expect(mocks.removePrivateFile).toHaveBeenNthCalledWith(
      2,
      "files/a-preview",
    );
  });

  it("物理文件删除失败时写 FAILED 审计", async () => {
    mocks.milestoneCommentFindFirst.mockResolvedValue({
      id: "comment-1",
      body: "<p>我的评论</p>",
      authorId: "author-1",
      visibility: "CUSTOMER_VISIBLE",
      attachments: [{ storageKey: "files/b", previewStorageKey: null }],
    });
    mocks.milestoneCommentDelete.mockResolvedValue({ id: "comment-1" });
    mocks.removePrivateFile.mockRejectedValueOnce(new Error("disk busy"));

    await deleteMilestoneComment(
      authorActor,
      "project-1",
      "milestone-1",
      "comment-1",
    );

    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      authorActor,
      expect.objectContaining({
        action: "MILESTONE_COMMENT_ATTACHMENT_FILE_DELETE_FAILED",
        result: "FAILED",
        metadata: {
          milestoneId: "milestone-1",
          failed: [{ storageKey: "files/b", error: "disk busy" }],
        },
      }),
    );
  });

  it("持评论权限的员工可以删除客户的里程碑评论", async () => {
    mocks.milestoneCommentFindFirst.mockResolvedValue({
      id: "comment-1",
      body: "<p>客户的评论</p>",
      authorId: "author-1",
      visibility: "CUSTOMER_VISIBLE",
      attachments: [],
    });
    mocks.milestoneCommentDelete.mockResolvedValue({ id: "comment-1" });

    const result = await deleteMilestoneComment(
      staffActor,
      "project-1",
      "milestone-1",
      "comment-1",
    );
    expect(result).toEqual({ deleted: true });
  });
});
