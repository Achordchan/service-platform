import { describe, expect, it } from "vitest";

/**
 * 「添加到项目文件」的安全前提：收录只翻 pinnedToProjectAt 这一个标记，
 * 不改 serviceRequestId / projectId 等归属字段。attachment_access 策略正是
 * 按归属裁决的 —— 归属不变，可见性就一定不会被放宽。
 */
describe("附件收录进项目文件不放宽可见性", () => {
  it("RLS 策略按 serviceRequestId 归属裁决，与收录标记无关", async () => {
    const { readFile } = await import("node:fs/promises");
    const policy = await readFile(
      "prisma/migrations/20260713171000_visibility_rls/migration.sql",
      "utf8",
    );
    const attachmentPolicy = policy.slice(
      policy.indexOf("CREATE POLICY attachment_access"),
    );
    // 工单附件仍由 app_can_access_request 裁决
    expect(attachmentPolicy).toContain(
      '"serviceRequestId" IS NOT NULL\n        AND app_can_access_request("serviceRequestId")',
    );
    // 客户始终读不到内部可见性的附件
    expect(attachmentPolicy).toContain(
      "(app_is_staff() OR visibility = 'CUSTOMER_VISIBLE')",
    );
    // 策略里不存在任何 pinned 相关条件 —— 收录不参与可见性判断
    expect(attachmentPolicy).not.toContain("pinned");
  });

  it("收录迁移只新增标记列，不触碰归属列", async () => {
    const { readFile } = await import("node:fs/promises");
    const sql = await readFile(
      "prisma/migrations/20260828160000_attachment_pin_to_project/migration.sql",
      "utf8",
    );
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "pinnedToProjectAt"');
    for (const owner of [
      "serviceRequestId",
      "requestMessageId",
      "projectUpdateId",
      "visibility",
    ]) {
      expect(sql).not.toContain(`"${owner}"`);
    }
  });
});

describe("动态 / 里程碑附件", () => {
  it("上传路由拒绝同时挂两个目标，也拒绝把内嵌图当附件挂", async () => {
    const { readFile } = await import("node:fs/promises");
    const route = await readFile("src/app/api/v1/attachments/route.ts", "utf8");
    expect(route).toContain("ATTACHMENT_TARGET_CONFLICT");
    expect(route).toContain("ATTACHMENT_PROJECT_REQUIRED");
    // 内嵌图与文件附件互斥：inline 图走 claim 流程，不应带实体 id
    expect(route).toContain(
      "(normalizedUpdateId || normalizedMilestoneId) && inline",
    );
  });

  it("动态附件的可见性由服务端跟随动态派生，不信客户端", async () => {
    const { readFile } = await import("node:fs/promises");
    const service = await readFile(
      "src/modules/attachments/attachment-service.ts",
      "utf8",
    );
    expect(service).toContain(
      "const visibility = context.attachVisibility ?? input.visibility",
    );
    // 目标实体必须属于同一项目，否则可跨项目挂载
    expect(service).toContain(
      "where: { id: input.attachTo.id, projectId: input.projectId }",
    );
  });

  it("项目文件自动收录动态/里程碑附件，但不含正文内嵌图", async () => {
    const { readFile } = await import("node:fs/promises");
    const query = await readFile(
      "src/modules/projects/project-detail-query.ts",
      "utf8",
    );
    expect(query).toContain("{ projectUpdateId: { not: null }, inline: false }");
    expect(query).toContain("{ milestoneId: { not: null }, inline: false }");
  });
});

describe("项目列表的里程碑计数", () => {
  it("只开里程碑模块、未开进度时也要取里程碑，否则列表显示 0/0", async () => {
    const { readFile } = await import("node:fs/promises");
    const query = await readFile(
      "src/modules/projects/project-summary-query.ts",
      "utf8",
    );
    expect(query).toContain(
      "actor.isStaff || project.showProgress || project.showMilestones",
    );
  });
});
