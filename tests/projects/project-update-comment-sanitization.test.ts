import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/actor";

const mocks = vi.hoisted(() => ({
  projectUpdateFindFirst: vi.fn(),
  commentFindFirst: vi.fn(),
  commentCreate: vi.fn(),
  commentUpdate: vi.fn(),
  revisionCreate: vi.fn(),
  createContentRiskReview: vi.fn(),
  enforceActorPublicContentRules: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/actor", () => ({
  withActorDb: (_actor: Actor, callback: (tx: unknown) => unknown) =>
    callback({
      projectUpdate: { findFirst: mocks.projectUpdateFindFirst },
      updateComment: {
        findFirst: mocks.commentFindFirst,
        create: mocks.commentCreate,
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
}));

vi.mock("@/modules/projects/project-access", () => ({
  assertCanViewCustomerProjectFeature: vi.fn(async () => ({
    customerSpaceId: "space-1",
    access: { isCustomerSpaceMember: true, projectRole: null },
  })),
  assertCanCommentOnProjectUpdate: vi.fn(),
  assertCanPublishActiveProjectUpdate: vi.fn(),
}));

vi.mock("@/modules/plugins/content-risk-service", () => ({
  createContentRiskReview: mocks.createContentRiskReview,
  enforceActorPublicContentRules: mocks.enforceActorPublicContentRules,
}));

vi.mock("@/modules/plugins/content-risk-view-service", () => ({
  loadContentRiskPageState: vi.fn(),
  isContentRiskStateRevoked: vi.fn(),
  contentRiskStatusFor: vi.fn(),
}));

import {
  createUpdateComment,
  updateUpdateComment,
} from "@/modules/projects/project-update-service";

const customer: Actor = {
  id: "customer-1",
  name: "客户",
  email: "customer@example.test",
  platformRole: "CUSTOMER",
  isPlatformAdmin: false,
  isStaff: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.projectUpdateFindFirst.mockResolvedValue({
    id: "update-1",
    visibility: "CUSTOMER_VISIBLE",
  });
  mocks.createContentRiskReview.mockResolvedValue(null);
  mocks.enforceActorPublicContentRules.mockResolvedValue(undefined);
  mocks.revisionCreate.mockResolvedValue({ id: "revision-1" });
});

describe("项目动态评论 HTML 消毒", () => {
  it("创建评论时只保存消毒后的正文", async () => {
    mocks.commentCreate.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: "comment-1",
        ...data,
        author: { id: customer.id, name: customer.name },
      }),
    );

    const comment = await createUpdateComment(
      customer,
      "project-1",
      "update-1",
      {
        body: '<p>正常评论</p><img src=x onerror="alert(1)"><script>alert(2)</script>',
      },
    );

    expect(mocks.commentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ body: "<p>正常评论</p>" }),
      }),
    );
    expect(comment.body).toBe("<p>正常评论</p>");
  });

  it("编辑评论时用消毒后的正文更新，并安全保存旧版本", async () => {
    const existing = {
      id: "comment-1",
      body: '<p>旧评论</p><img src=x onerror="alert(1)">',
      authorId: customer.id,
      visibility: "CUSTOMER_VISIBLE" as const,
    };
    mocks.commentFindFirst.mockResolvedValue(existing);
    mocks.commentUpdate.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        ...existing,
        ...data,
        author: { id: customer.id, name: customer.name },
      }),
    );

    const comment = await updateUpdateComment(
      customer,
      "project-1",
      "update-1",
      "comment-1",
      { body: "<p>修改后</p><script>alert(2)</script>" },
    );

    expect(mocks.revisionCreate).toHaveBeenCalledWith({
      data: {
        updateCommentId: "comment-1",
        body: "<p>旧评论</p>",
        visibility: "CUSTOMER_VISIBLE",
        editedById: customer.id,
      },
    });
    expect(mocks.commentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ body: "<p>修改后</p>" }),
      }),
    );
    expect(comment.body).toBe("<p>修改后</p>");
  });

  it("消毒后没有有效内容时拒绝创建评论", async () => {
    await expect(
      createUpdateComment(customer, "project-1", "update-1", {
        body: '<img src=x onerror="alert(1)"><script>alert(2)</script>',
      }),
    ).rejects.toMatchObject({
      code: "EMPTY_UPDATE_COMMENT",
      status: 422,
    });
    expect(mocks.commentCreate).not.toHaveBeenCalled();
  });
});
