import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/actor";

const mocks = vi.hoisted(() => ({
  attachmentFindUnique: vi.fn(),
  attachmentDelete: vi.fn(),
  writeAuditLog: vi.fn(),
  publishEvent: vi.fn(),
  removePrivateFile: vi.fn(),
  loadProjectAccess: vi.fn(),
  assertCanPublishProjectUpdate: vi.fn(),
  assertCanManageProjectDelivery: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/actor", () => ({
  withActorDb: (_actor: Actor, callback: (tx: unknown) => unknown) =>
    callback({
      attachment: {
        findUnique: mocks.attachmentFindUnique,
        delete: mocks.attachmentDelete,
      },
    }),
}));

vi.mock("@/modules/audit/audit-service", () => ({
  writeAuditLog: mocks.writeAuditLog,
}));

vi.mock("@/modules/notifications/notification-service", () => ({
  dispatchProjectActivity: vi.fn(),
  dispatchRequestActivity: vi.fn(),
  publishEvent: mocks.publishEvent,
}));

vi.mock("@/modules/attachments/private-storage", () => ({
  createStorageKey: vi.fn(),
  createProjectStorageKey: vi.fn(),
  createSupportPlaybookStorageKey: vi.fn(),
  readPrivateFile: vi.fn(),
  removePrivateFile: mocks.removePrivateFile,
  writePrivateFile: vi.fn(),
}));

vi.mock("@/modules/attachments/attachment-validation", () => ({
  getAttachmentPolicy: vi.fn(),
  validateAttachmentFile: vi.fn(),
}));

vi.mock("@/lib/jobs", () => ({
  queueAttachmentPreviewRender: vi.fn(),
}));

vi.mock("@/modules/plugins/plugin-scheduler", () => ({
  scheduleAttachmentPluginJobs: vi.fn(),
}));

vi.mock("@/modules/plugins/content-risk-service", () => ({
  createContentRiskReview: vi.fn(),
  enforceActorPublicContentRules: vi.fn(),
  isContentRiskAttachmentRevoked: vi.fn(),
}));

vi.mock("@/modules/projects/project-access", () => ({
  assertCanManageActiveProjectDelivery: vi.fn(),
  assertCanManageProjectDelivery: mocks.assertCanManageProjectDelivery,
  assertCanPublishActiveProjectUpdate: vi.fn(),
  assertCanPublishProjectUpdate: mocks.assertCanPublishProjectUpdate,
  assertCanUploadActiveProjectFile: vi.fn(),
  assertCanViewCustomerProjectFeature: vi.fn(),
  loadProjectAccess: mocks.loadProjectAccess,
}));

import { deleteProjectAttachment } from "@/modules/attachments/attachment-service";

const admin: Actor = {
  id: "admin-1",
  name: "管理员",
  email: "admin@example.test",
  platformRole: "PLATFORM_ADMIN",
  isPlatformAdmin: true,
  isStaff: true,
};

const baseAttachment = {
  id: "attachment-1",
  originalName: "合同.pdf",
  title: null,
  mimeType: "application/pdf",
  size: 1024,
  visibility: "CUSTOMER_VISIBLE" as const,
  inline: false,
  storageKey: "projects/p1/a1.pdf",
  previewStorageKey: null,
  projectId: "project-1",
  customerSpaceId: "space-1",
  serviceRequestId: null,
  requestMessageId: null,
  projectUpdateId: null,
  updateCommentId: null,
  milestoneId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadProjectAccess.mockResolvedValue({
    projectId: "project-1",
    projectStatus: "ACTIVE",
    customerSpaceId: "space-1",
    access: { isCustomerSpaceMember: false, projectRole: "PROJECT_MANAGER" },
  });
  mocks.attachmentDelete.mockResolvedValue({ id: "attachment-1" });
});

describe("删除项目文件", () => {
  it("删除项目级文件：落库、写审计、清掉存储文件并广播刷新", async () => {
    mocks.attachmentFindUnique.mockResolvedValue({
      ...baseAttachment,
      previewStorageKey: "projects/p1/a1.preview.pdf",
    });

    const result = await deleteProjectAttachment(admin, "attachment-1");

    expect(result).toEqual({ deleted: true });
    expect(mocks.attachmentDelete).toHaveBeenCalledWith({
      where: { id: "attachment-1" },
    });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      admin,
      expect.objectContaining({
        action: "PROJECT_ATTACHMENT_DELETED",
        resourceId: "attachment-1",
        projectId: "project-1",
      }),
    );
    // 派生预览件也要一起清掉，否则磁盘上留孤儿
    expect(mocks.removePrivateFile).toHaveBeenCalledWith("projects/p1/a1.pdf");
    expect(mocks.removePrivateFile).toHaveBeenCalledWith(
      "projects/p1/a1.preview.pdf",
    );
    expect(mocks.publishEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: "PROJECT_UPDATED",
        payload: expect.objectContaining({
          change: "PROJECT_ATTACHMENT_DELETED",
          audible: false,
        }),
      }),
    );
  });

  it("工单沟通里收录来的文件不给删，引导去「移出项目文件」", async () => {
    mocks.attachmentFindUnique.mockResolvedValue({
      ...baseAttachment,
      serviceRequestId: "request-1",
    });

    await expect(
      deleteProjectAttachment(admin, "attachment-1"),
    ).rejects.toMatchObject({ code: "ATTACHMENT_FROM_REQUEST" });
    expect(mocks.attachmentDelete).not.toHaveBeenCalled();
  });

  it("正文内嵌图不给删：它跟着正文走，删了正文里就是断图", async () => {
    mocks.attachmentFindUnique.mockResolvedValue({
      ...baseAttachment,
      inline: true,
    });

    await expect(
      deleteProjectAttachment(admin, "attachment-1"),
    ).rejects.toMatchObject({ code: "ATTACHMENT_INLINE" });
    expect(mocks.attachmentDelete).not.toHaveBeenCalled();
  });

  it("动态附件按发布权限裁决，里程碑附件按交付管理权限裁决", async () => {
    mocks.attachmentFindUnique.mockResolvedValue({
      ...baseAttachment,
      projectUpdateId: "update-1",
    });
    await deleteProjectAttachment(admin, "attachment-1");
    expect(mocks.assertCanPublishProjectUpdate).toHaveBeenCalledWith(
      expect.anything(),
      admin,
      "project-1",
    );
    expect(mocks.loadProjectAccess).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mocks.attachmentDelete.mockResolvedValue({ id: "attachment-1" });
    mocks.attachmentFindUnique.mockResolvedValue({
      ...baseAttachment,
      milestoneId: "milestone-1",
    });
    await deleteProjectAttachment(admin, "attachment-1");
    expect(mocks.assertCanManageProjectDelivery).toHaveBeenCalledWith(
      expect.anything(),
      admin,
      "project-1",
    );
  });

  it("没有上传权限的员工删不了项目级文件", async () => {
    mocks.attachmentFindUnique.mockResolvedValue(baseAttachment);
    mocks.loadProjectAccess.mockResolvedValue({
      projectId: "project-1",
      projectStatus: "ACTIVE",
      customerSpaceId: "space-1",
      access: { isCustomerSpaceMember: false, projectRole: "TECHNICIAN" },
    });
    const technician: Actor = {
      id: "staff-1",
      name: "技术员",
      email: "tech@example.test",
      platformRole: "TECHNICIAN",
      isPlatformAdmin: false,
      isStaff: true,
    };

    await expect(
      deleteProjectAttachment(technician, "attachment-1"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.attachmentDelete).not.toHaveBeenCalled();
  });
});
