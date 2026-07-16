import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  readPrivateFile,
  removePrivateFile,
  writePrivateFile,
} from "@/modules/attachments/private-storage";
import {
  optimizeAttachmentWithWebp,
  processImageWebpMigrationBatch,
} from "@/modules/plugins/image-webp-runtime-service";
import { ensurePluginInstallations } from "@/modules/plugins/plugin-installation-service";
import { IMAGE_WEBP_PLUGIN_KEY } from "@/modules/plugins/plugin-registry";

const pool = new Pool({
  connectionString: process.env.DATABASE_MIGRATION_URL,
  max: 1,
});

const fixture = {
  spaceId: randomUUID(),
  projectId: randomUUID(),
  attachmentId: randomUUID(),
  storageKey: `projects/image-webp-${randomUUID()}/source.jpg`,
  corruptAttachmentId: randomUUID(),
  corruptStorageKey: `projects/image-webp-${randomUUID()}/corrupt.jpg`,
  runId: randomUUID(),
  runExecutionToken: randomUUID(),
};

const jpeg = Buffer.from(
  "/9j/2wBDAAIBAQEBAQIBAQECAgICAgQDAgICAgUEBAMEBgUGBgYFBgYGBwkIBgcJBwYGCAsICQoKCgoKBggLDAsKDAkKCgr/2wBDAQICAgICAgUDAwUKBwYHCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgr/wAARCAIAAgADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCygCkTYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/2Q==",
  "base64",
);

let adminId = "";
let customerId = "";
let serviceTypeId = "";
let replacementStorageKey = "";
let previousInstallation: {
  enabled: boolean;
  config: Record<string, unknown>;
} | null = null;

beforeAll(async () => {
  await ensurePluginInstallations();
  const context = await pool.query<{
    admin_id: string;
    customer_id: string;
    service_type_id: string;
  }>(
    `
      SELECT
        admin.id AS admin_id,
        customer.id AS customer_id,
        service_type.id AS service_type_id
      FROM "User" admin
      CROSS JOIN "User" customer
      CROSS JOIN "ServiceType" service_type
      WHERE admin.email = 'admin@local.test'
        AND customer.email = 'client@local.test'
      LIMIT 1
    `,
  );
  const row = context.rows[0];
  if (!row) throw new Error("请先执行 pnpm db:seed");
  adminId = row.admin_id;
  customerId = row.customer_id;
  serviceTypeId = row.service_type_id;

  const installation = await pool.query<{
    enabled: boolean;
    config: Record<string, unknown>;
  }>(
    `
      SELECT enabled, config
      FROM "PluginInstallation"
      WHERE "key" = $1
    `,
    [IMAGE_WEBP_PLUGIN_KEY],
  );
  previousInstallation = installation.rows[0] ?? null;
  await pool.query(
    `
      UPDATE "PluginInstallation"
      SET
        enabled = true,
        config = $2::jsonb,
        "updatedAt" = NOW()
      WHERE "key" = $1
    `,
    [
      IMAGE_WEBP_PLUGIN_KEY,
      JSON.stringify({
        quality: 82,
        effort: 2,
        maxInputMegapixels: 40,
        minimumSavingsPercent: 5,
      }),
    ],
  );

  await pool.query(
    `
      INSERT INTO "CustomerSpace" (
        id,
        name,
        slug,
        "ownerId",
        "updatedAt"
      )
      VALUES ($1, 'WebP 集成测试客户', $2, $3, NOW())
    `,
    [fixture.spaceId, `image-webp-${randomUUID()}`, customerId],
  );
  await pool.query(
    `
      INSERT INTO "Project" (
        id,
        title,
        "customerSpaceId",
        "serviceTypeId",
        "createdById",
        "updatedAt"
      )
      VALUES ($1, 'WebP 集成测试项目', $2, $3, $4, NOW())
    `,
    [fixture.projectId, fixture.spaceId, serviceTypeId, adminId],
  );
  await writePrivateFile(fixture.storageKey, jpeg);
  await pool.query(
    `
      INSERT INTO "Attachment" (
        id,
        "originalName",
        "storageKey",
        "mimeType",
        size,
        "customerSpaceId",
        "projectId",
        "uploadedById"
      )
      VALUES ($1, 'source.jpg', $2, 'image/jpeg', $3, $4, $5, $6)
    `,
    [
      fixture.attachmentId,
      fixture.storageKey,
      jpeg.byteLength,
      fixture.spaceId,
      fixture.projectId,
      adminId,
    ],
  );
  const corruptImage = Buffer.from("not-a-real-jpeg");
  await writePrivateFile(fixture.corruptStorageKey, corruptImage);
  await pool.query(
    `
      INSERT INTO "Attachment" (
        id,
        "originalName",
        "storageKey",
        "mimeType",
        size,
        "customerSpaceId",
        "projectId",
        "uploadedById"
      )
      VALUES ($1, 'corrupt.jpg', $2, 'image/jpeg', $3, $4, $5, $6)
    `,
    [
      fixture.corruptAttachmentId,
      fixture.corruptStorageKey,
      corruptImage.byteLength,
      fixture.spaceId,
      fixture.projectId,
      adminId,
    ],
  );
  await pool.query(
    `
      INSERT INTO "PluginRun" (
        id,
        "pluginKey",
        kind,
        status,
        "executionToken",
        "requestedById",
        "updatedAt"
      )
      VALUES (
        $1,
        $2,
        'HISTORY_MIGRATION',
        'QUEUED',
        $3,
        $4,
        NOW()
      )
    `,
    [
      fixture.runId,
      IMAGE_WEBP_PLUGIN_KEY,
      fixture.runExecutionToken,
      adminId,
    ],
  );
});

afterAll(async () => {
  await pool.query(`DELETE FROM "PluginRun" WHERE id = $1`, [fixture.runId]);
  await pool.query(
    `
      DELETE FROM "PluginResourceState"
      WHERE "pluginKey" = $1
        AND "resourceType" = 'ATTACHMENT'
        AND "resourceId" = ANY($2::text[])
    `,
    [
      IMAGE_WEBP_PLUGIN_KEY,
      [fixture.attachmentId, fixture.corruptAttachmentId],
    ],
  );
  await pool.query(`DELETE FROM "Project" WHERE id = $1`, [fixture.projectId]);
  await pool.query(`DELETE FROM "CustomerSpace" WHERE id = $1`, [
    fixture.spaceId,
  ]);
  if (previousInstallation) {
    await pool.query(
      `
        UPDATE "PluginInstallation"
        SET
          enabled = $2,
          config = $3::jsonb,
          "updatedAt" = NOW()
        WHERE "key" = $1
      `,
      [
        IMAGE_WEBP_PLUGIN_KEY,
        previousInstallation.enabled,
        JSON.stringify(previousInstallation.config),
      ],
    );
  }
  await removePrivateFile(fixture.storageKey);
  await removePrivateFile(fixture.corruptStorageKey);
  if (replacementStorageKey) {
    await removePrivateFile(replacementStorageKey);
  }
  await pool.end();
});

describe("WebP 插件文件替换", () => {
  it("条件切换附件记录后删除原文件，并保留可解码的新文件", async () => {
    const outcome = await optimizeAttachmentWithWebp(fixture.attachmentId, {
      source: "HISTORY",
    });
    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.savedBytes).toBeGreaterThan(0);

    const result = await pool.query<{
      storage_key: string;
      mime_type: string;
      size: number;
      resource_status: string;
    }>(
      `
        SELECT
          attachment."storageKey" AS storage_key,
          attachment."mimeType" AS mime_type,
          attachment.size,
          resource_state.status::text AS resource_status
        FROM "Attachment" attachment
        JOIN "PluginResourceState" resource_state
          ON resource_state."pluginKey" = $2
          AND resource_state."resourceType" = 'ATTACHMENT'
          AND resource_state."resourceId" = attachment.id
        WHERE attachment.id = $1
      `,
      [fixture.attachmentId, IMAGE_WEBP_PLUGIN_KEY],
    );
    const attachment = result.rows[0];
    replacementStorageKey = attachment.storage_key;
    expect(attachment).toMatchObject({
      mime_type: "image/webp",
      resource_status: "COMPLETED",
    });
    expect(attachment.storage_key).toMatch(/\.webp$/);
    expect(attachment.size).toBeLessThan(jpeg.byteLength);

    const replacement = await readPrivateFile(attachment.storage_key);
    expect(replacement.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(replacement.subarray(8, 12).toString("ascii")).toBe("WEBP");
    await expect(readPrivateFile(fixture.storageKey)).rejects.toMatchObject({
      code: "ENOENT",
    });

    const repeated = await optimizeAttachmentWithWebp(fixture.attachmentId, {
      source: "HISTORY",
    });
    expect(repeated).toMatchObject({
      status: "COMPLETED",
      sourceBytes: jpeg.byteLength,
      outputBytes: attachment.size,
      savedBytes: jpeg.byteLength - attachment.size,
    });
    const repeatedState = await pool.query<{ status: string }>(
      `
        SELECT status::text
        FROM "PluginResourceState"
        WHERE "pluginKey" = $1
          AND "resourceType" = 'ATTACHMENT'
          AND "resourceId" = $2
      `,
      [IMAGE_WEBP_PLUGIN_KEY, fixture.attachmentId],
    );
    expect(repeatedState.rows[0]?.status).toBe("COMPLETED");
  });

  it("文件签名不匹配时记录失败并完整保留原附件", async () => {
    const outcome = await optimizeAttachmentWithWebp(
      fixture.corruptAttachmentId,
      { source: "HISTORY" },
    );
    expect(outcome).toMatchObject({
      status: "FAILED",
      savedBytes: 0,
      reason: "IMAGE_SIGNATURE_MISMATCH",
    });

    const result = await pool.query<{
      storage_key: string;
      mime_type: string;
      resource_status: string;
    }>(
      `
        SELECT
          attachment."storageKey" AS storage_key,
          attachment."mimeType" AS mime_type,
          resource_state.status::text AS resource_status
        FROM "Attachment" attachment
        JOIN "PluginResourceState" resource_state
          ON resource_state."pluginKey" = $2
          AND resource_state."resourceType" = 'ATTACHMENT'
          AND resource_state."resourceId" = attachment.id
        WHERE attachment.id = $1
      `,
      [fixture.corruptAttachmentId, IMAGE_WEBP_PLUGIN_KEY],
    );
    expect(result.rows[0]).toEqual({
      storage_key: fixture.corruptStorageKey,
      mime_type: "image/jpeg",
      resource_status: "FAILED",
    });
    await expect(readPrivateFile(fixture.corruptStorageKey)).resolves.toEqual(
      Buffer.from("not-a-real-jpeg"),
    );
  });

  it("暂停后遗留的旧队列令牌不会重新启动迁移任务", async () => {
    await expect(
      processImageWebpMigrationBatch(fixture.runId, randomUUID()),
    ).resolves.toBe(false);

    const run = await pool.query<{
      status: string;
      execution_token: string;
      processed_count: number;
    }>(
      `
        SELECT
          status::text,
          "executionToken" AS execution_token,
          "processedCount" AS processed_count
        FROM "PluginRun"
        WHERE id = $1
      `,
      [fixture.runId],
    );
    expect(run.rows[0]).toEqual({
      status: "QUEUED",
      execution_token: fixture.runExecutionToken,
      processed_count: 0,
    });
  });
});
