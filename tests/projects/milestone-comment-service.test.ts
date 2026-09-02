import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/actor";

const mocks = vi.hoisted(() => ({
  milestoneCommentFindFirst: vi.fn(),
  milestoneCommentFindMany: vi.fn(),
  milestoneCommentCreate: vi.fn(),
  milestoneCommentUpdate: vi.fn(),
  milestoneCommentDelete: vi.fn(),
  milestoneFindFirst: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/actor", () => ({
  withActorDb: (_actor: Actor, callback: (tx: unknown) => unknown) =>
    callback({
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

vi.mock("@/modules/audit/audit-service", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("@/modules/notifications/notification-service", () => ({
  dispatchProjectActivity: vi.fn(async () => ({ feedback: { skipped: [] } })),
  publishProjectChange: vi.fn(),
  previewProjectActivityRecipients: vi.fn(),
}));

vi.mock("@/modules/projects/project-access", () => ({
  // access 按调用者身份给：员工有项目角色，客户作者走空间成员身份
  assertCanViewCustomerProjectFeature: vi.fn(
    async (_tx: unknown, actor: Actor) => ({
      customerSpaceId: "space-1",
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
  isContentRiskStateRevoked: vi.fn(() => false),
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

  it("作者本人可以删除自己的里程碑评论", async () => {
    mocks.milestoneCommentFindFirst.mockResolvedValue({
      id: "comment-1",
      body: "<p>我的评论</p>",
      authorId: "author-1",
      visibility: "CUSTOMER_VISIBLE",
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

  it("持评论权限的员工可以删除客户的里程碑评论", async () => {
    mocks.milestoneCommentFindFirst.mockResolvedValue({
      id: "comment-1",
      body: "<p>客户的评论</p>",
      authorId: "author-1",
      visibility: "CUSTOMER_VISIBLE",
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
