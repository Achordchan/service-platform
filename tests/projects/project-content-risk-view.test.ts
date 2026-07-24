import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/actor";

const mocks = vi.hoisted(() => ({
  projectUpdates: vi.fn(),
  projectUpdate: vi.fn(),
  updateComments: vi.fn(),
  milestones: vi.fn(),
  loadRisk: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/system-db", () => ({
  withSystemDb: vi.fn(),
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

vi.mock("@/modules/plugins/content-risk-service", () => ({
  createContentRiskReview: vi.fn(),
  enforceActorPublicContentRules: vi.fn(),
}));

vi.mock("@/lib/actor", () => ({
  withActorDb: (_actor: Actor, callback: (tx: unknown) => unknown) =>
    callback({
      projectUpdate: {
        findMany: mocks.projectUpdates,
        findFirst: mocks.projectUpdate,
      },
      updateComment: { findMany: mocks.updateComments },
      milestone: { findMany: mocks.milestones },
    }),
}));

vi.mock("@/modules/projects/project-access", () => ({
  assertCanViewCustomerProjectFeature: vi.fn(async () => ({
    customerFeatures: { milestones: true, progress: true },
    customerSpaceId: "space-1",
    access: { isCustomerSpaceMember: true, projectRole: null },
  })),
  assertCanManageActiveProjectDelivery: vi.fn(),
  assertCanPublishActiveProjectUpdate: vi.fn(),
  assertCanCommentOnProjectUpdate: vi.fn(),
}));

vi.mock("@/modules/plugins/content-risk-view-service", () => ({
  loadContentRiskPageState: mocks.loadRisk,
  isContentRiskStateRevoked: (state?: { displayState?: string }) =>
    state?.displayState === "REVOKED",
  contentRiskStatusFor: (
    state: { displayState?: string; reviewStatus?: string } | undefined,
    options: { pluginEnabled: boolean; showPending: boolean },
  ) => {
    if (state?.displayState === "REVOKED") return "REVOKED";
    if (
      options.pluginEnabled &&
      options.showPending &&
      (state?.reviewStatus === "QUEUED" ||
        state?.reviewStatus === "PROCESSING")
    ) {
      return "PENDING";
    }
    return null;
  },
}));

import {
  listProjectUpdates,
  listUpdateComments,
} from "@/modules/projects/project-update-service";
import { listMilestones } from "@/modules/projects/milestone-service";

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
});

describe("项目公开内容风控查询", () => {
  it("独立动态和评论 API 不向非管理员返回撤回原文", async () => {
    const comment = {
      id: "comment-1",
      body: "请加我的隐藏账号",
      visibility: "CUSTOMER_VISIBLE",
      authorId: "staff-1",
      author: { id: "staff-1", name: "服务人员" },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mocks.projectUpdates.mockResolvedValue([
      {
        id: "update-1",
        title: "包含敏感信息的进度",
        body: "敏感进度原文",
        visibility: "CUSTOMER_VISIBLE",
        authorId: "staff-1",
        author: { id: "staff-1", name: "服务人员" },
        comments: [comment],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    mocks.projectUpdate.mockResolvedValue({
      id: "update-1",
      visibility: "CUSTOMER_VISIBLE",
    });
    mocks.updateComments.mockResolvedValue([comment]);
    mocks.loadRisk.mockResolvedValue({
      enabled: true,
      states: new Map([
        ["PROJECT_UPDATE:update-1", { displayState: "REVOKED" }],
        ["UPDATE_COMMENT:comment-1", { displayState: "REVOKED" }],
      ]),
    });

    const updates = await listProjectUpdates(customer, "project-1");
    const comments = await listUpdateComments(
      customer,
      "project-1",
      "update-1",
    );

    expect(updates[0]).toMatchObject({
      title: "",
      body: "",
      contentRiskStatus: "REVOKED",
    });
    expect(updates[0]?.comments[0]).toMatchObject({
      body: "",
      contentRiskStatus: "REVOKED",
    });
    expect(comments[0]).toMatchObject({
      body: "",
      contentRiskStatus: "REVOKED",
    });
  });

  it("撤回里程碑显示占位且不再计入项目进度", async () => {
    mocks.milestones.mockResolvedValue([
      {
        id: "milestone-revoked",
        title: "违规里程碑",
        description: "敏感说明",
        status: "COMPLETED",
        createdById: "staff-1",
      },
      {
        id: "milestone-safe",
        title: "正常里程碑",
        description: "正常说明",
        status: "NOT_STARTED",
        createdById: "staff-1",
      },
    ]);
    mocks.loadRisk.mockResolvedValue({
      enabled: true,
      states: new Map([
        ["MILESTONE:milestone-revoked", { displayState: "REVOKED" }],
      ]),
    });

    const result = await listMilestones(customer, "project-1");

    expect(result.milestones[0]).toMatchObject({
      title: "",
      description: null,
      contentRiskStatus: "REVOKED",
    });
    expect(result.progress).toMatchObject({
      percentage: 0,
      counts: { total: 1, completed: 0, notStarted: 1 },
    });
  });
});
