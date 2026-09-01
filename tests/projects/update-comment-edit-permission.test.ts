import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/actor";

const mocks = vi.hoisted(() => ({
  commentFindFirst: vi.fn(),
  commentUpdate: vi.fn(),
  revisionCreate: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/actor", () => ({
  withActorDb: (_actor: Actor, callback: (tx: unknown) => unknown) =>
    callback({
      updateComment: {
        findFirst: mocks.commentFindFirst,
        update: mocks.commentUpdate,
      },
      updateCommentRevision: { create: mocks.revisionCreate },
    }),
}));

vi.mock("@/modules/attachments/inline-attachment-service", () => ({
  claimUserInlineAttachments: vi.fn(),
}));

vi.mock("@/modules/attachments/private-storage", () => ({
  removePrivateFile: vi.fn(),
}));

vi.mock("@/modules/audit/audit-service", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("@/modules/notifications/notification-service", () => ({
  dispatchProjectActivity: vi.fn(),
  publishProjectChange: vi.fn(),
  previewProjectActivityRecipients: vi.fn(),
}));

vi.mock("@/modules/projects/project-access", () => ({
  assertCanViewCustomerProjectFeature: vi.fn(async () => ({
    customerSpaceId: "space-1",
    access: { isCustomerSpaceMember: false, projectRole: "PROJECT_MANAGER" },
  })),
  assertCanCommentOnProjectUpdate: vi.fn(),
  assertCanPublishActiveProjectUpdate: vi.fn(),
}));

vi.mock("@/modules/plugins/content-risk-service", () => ({
  createContentRiskReview: vi.fn(async () => null),
  enforceActorPublicContentRules: vi.fn(),
}));

vi.mock("@/modules/plugins/content-risk-view-service", () => ({
  loadContentRiskPageState: vi.fn(),
  isContentRiskStateRevoked: vi.fn(),
  contentRiskStatusFor: vi.fn(),
}));

import { updateUpdateComment } from "@/modules/projects/project-update-service";

const admin: Actor = {
  id: "admin-1",
  name: "管理员",
  email: "admin@example.test",
  platformRole: "PLATFORM_ADMIN",
  isPlatformAdmin: true,
  isStaff: true,
};

const customerComment = {
  id: "comment-1",
  body: "<p>客户留言</p>",
  authorId: "customer-1",
  visibility: "CUSTOMER_VISIBLE" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.commentFindFirst.mockResolvedValue(customerComment);
});

/**
 * 后台只能改自己发的评论。改客户说过的话不是后台该有的能力 ——
 * 违规内容有内容风控的撤回流程，不该靠替对方改写来处理。
 */
describe("动态评论的编辑权限", () => {
  it("平台管理员也不能编辑客户的评论", async () => {
    await expect(
      updateUpdateComment(admin, "project-1", "update-1", "comment-1", {
        body: "<p>管理员改写</p>",
      }),
    ).rejects.toMatchObject({ message: "只能修改自己发布的评论" });
    expect(mocks.commentUpdate).not.toHaveBeenCalled();
  });

  it("作者本人可以编辑自己的评论", async () => {
    mocks.commentFindFirst.mockResolvedValue({
      ...customerComment,
      authorId: admin.id,
    });
    mocks.commentUpdate.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        ...customerComment,
        ...data,
        author: { id: admin.id, name: admin.name },
      }),
    );

    const updated = await updateUpdateComment(
      admin,
      "project-1",
      "update-1",
      "comment-1",
      { body: "<p>我改我的</p>" },
    );

    expect(updated.body).toBe("<p>我改我的</p>");
  });
});
