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

describe("实体附件不重复发通知", () => {
  it("挂在动态/里程碑上的附件不再单独分发 PROJECT_FILE 活动", async () => {
    const { readFile } = await import("node:fs/promises");
    const service = await readFile(
      "src/modules/attachments/attachment-service.ts",
      "utf8",
    );
    // 附件上传是独立请求、不带 deliveryOverride：再发一次不但重复打扰
    // （一条带三个附件的动态多出三条通知），还会绕开本次「不提醒 / 排除某人」
    expect(service).toContain("if (!input.inlineContext && !input.attachTo) {");
  });
});

describe("文件来源筛选", () => {
  it("按 source 分类而非 pinned —— 自动收录的附件没有 pinnedToProjectAt", async () => {
    const { readFile } = await import("node:fs/promises");
    for (const path of [
      "src/components/staff/project-file-manager.tsx",
      "miniapp/src/pages/project-detail/page.ts",
    ]) {
      const source = await readFile(path, "utf8");
      expect(source).toContain('(file.source ?? "PROJECT") !== "PROJECT"');
      // 旧写法会把动态/里程碑附件错归成「项目文件」
      expect(source).not.toContain('source === "PINNED" ? file.pinned');
    }
  });
});

describe("外部联系人的设备信息读取", () => {
  it("走 SECURITY DEFINER 函数，且函数自己把住员工与工单访问权两道门", async () => {
    const { readFile } = await import("node:fs/promises");
    const sql = await readFile(
      "prisma/migrations/20260828190000_external_client_context_read/migration.sql",
      "utf8",
    );
    // 绕过 RLS 的函数必须自带门禁，否则等于把会话表读权开给所有人
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("AND app_is_staff()");
    expect(sql).toContain("AND app_can_access_request(request_id)");
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION app_external_request_client_contexts(text) FROM PUBLIC",
    );

    const service = await readFile(
      "src/modules/requests/request-presence-service.ts",
      "utf8",
    );
    // 直接查会话表的话，external_embed_session_select 只放行会话本人与平台管理员，
    // 普通项目经理/技术人员会被静默过滤成零行 —— 设备信息永远是空的
    expect(service).not.toContain("tx.externalEmbedSession.findMany");
    expect(service).toContain("app_external_request_client_contexts(");
  });
});

describe("附件重试不重复发通知", () => {
  it("内容与上次保存一致时跳过实体提交，只补传附件", async () => {
    const { readFile } = await import("node:fs/promises");
    for (const path of [
      "miniapp/src/pages/update-edit/page.ts",
      "miniapp/src/pages/milestone-edit/page.ts",
    ]) {
      const page = await readFile(path, "utf8");
      // editProjectUpdate / editMilestone 每次调用都无条件分发一条通知，
      // 附件重试若连实体一起再提交，重试几次就骚扰几次
      expect(page).toContain("savedSnapshot");
      expect(page).toContain("if (snapshot !== this.savedSnapshot) {");
      // 载入时必须初始化快照：留空的话首次提交必然与它不同，一字未改也会发通知
      expect(page).toContain("this.savedSnapshot = this.contentSnapshot(");
      // 且载入与提交要用同一个算法，否则「一字未改」判不出来，等于没初始化
      expect(page).toContain("const snapshot = this.contentSnapshot(");
    }
  });
});

describe("工单回复的附件不重复发通知", () => {
  it("绑在回复上的附件只发静默刷新事件，不再按 REQUEST_ATTACHMENT 默认规则通知", async () => {
    const { readFile } = await import("node:fs/promises");
    const service = await readFile(
      "src/modules/attachments/attachment-service.ts",
      "utf8",
    );
    // 附件上传是另一个请求、不带 deliveryOverride：再发一次通知的话，
    // 被「本次不提醒」排除掉的人会为每个附件各收一条
    expect(service).toContain("if (!input.inline && input.requestMessageId) {");
    const block = service.slice(
      service.indexOf("if (!input.inline && input.requestMessageId) {"),
      service.indexOf("} else if (!input.inline) {"),
    );
    expect(block).toContain("publishEvent(");
    expect(block).toContain("audible: false");
  });
});

describe("附件派生事件要带上归属实体", () => {
  it("优化完成 / 预览就绪都要带 id，否则会被当成项目级文件过滤掉", async () => {
    const { readFile } = await import("node:fs/promises");
    for (const path of [
      "src/modules/plugins/image-webp-runtime-service.ts",
      "src/modules/attachments/preview-render-service.ts",
    ]) {
      const source = await readFile(path, "utf8");
      // 查询要取到归属 id，payload 才带得出去
      expect(source).toContain("projectUpdateId: true");
      expect(source).toContain("milestoneId: true");
      expect(source).toContain("attachmentEventPayload(attachment)");
      // 不能再退回只带 attachmentId 的写法
      expect(source).not.toContain("payload: { attachmentId: attachment.id }");
    }
  });
});

describe("实体附件仍要发静默刷新事件", () => {
  it("不发通知，但要让停在项目详情页的人刷出附件", async () => {
    const { readFile } = await import("node:fs/promises");
    const service = await readFile(
      "src/modules/attachments/attachment-service.ts",
      "utf8",
    );
    // 实体先建好、附件随后逐个上传：不补事件的话，别人页面停在「没有附件」
    // 的版本，要等手动重载或下一次项目事件才刷得出来
    const block = service.slice(
      service.indexOf("if (input.attachTo && !input.inlineContext) {"),
      service.indexOf("if (!input.inlineContext && !input.attachTo) {"),
    );
    expect(block).toContain("publishEvent(");
    // 只刷新、不打扰：不建通知行，也不响铃
    expect(block).toContain("audible: false");
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
