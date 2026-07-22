import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import {
  buildDefaultSupportReplyPlaybookContent,
  getDefaultSupportReplyPlaybook,
  getDefaultSupportReplyPlaybookOrder,
  parseSupportPlaybookSnapshot,
  type SupportReplyPlaybookView,
} from "@/lib/support-reply-playbooks";
import {
  buildMessagePreview,
  extractInlineAttachmentIds,
  hasMeaningfulHtml,
} from "@/lib/message-content";
import { sanitizeMessageHtml } from "@/lib/sanitize-html";
import { claimSupportPlaybookInlineAttachments } from "@/modules/attachments/inline-attachment-service";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { DomainError, assertAllowed } from "@/modules/projects/errors";
import type {
  CreateSupportPlaybookInput,
  UpdateSupportPlaybookInput,
} from "@/modules/requests/support-playbook-schemas";

type PlaybookRecord = {
  key: string;
  category: "REMOTE" | "DIAGNOSTIC" | "INFORMATION";
  title: string;
  summary: string;
  introduction: string;
  content: string | null;
  steps: unknown;
  safetyNotes: unknown;
  active: boolean;
  sortOrder: number;
  isBuiltin: boolean;
  updatedAt: Date;
  deletedAt: Date | null;
};

function parseRecord(record: PlaybookRecord): SupportReplyPlaybookView {
  const content = record.content
    ? sanitizeMessageHtml(record.content)
    : undefined;
  const playbook = parseSupportPlaybookSnapshot({
    key: record.key,
    category: record.category,
    title: record.title,
    summary: record.summary,
    introduction: record.introduction,
    ...(content ? { content } : {}),
    steps: record.steps,
    safetyNotes: record.safetyNotes,
  });
  if (!playbook) {
    throw new DomainError(
      "SUPPORT_PLAYBOOK_INVALID_DATA",
      `处理指南“${record.title}”的数据格式无效`,
      500,
    );
  }
  return {
    ...playbook,
    active: record.active,
    sortOrder: record.sortOrder,
    isBuiltin: record.isBuiltin,
    updatedAt: record.updatedAt.toISOString(),
    deletedAt: record.deletedAt?.toISOString() ?? null,
  };
}

const playbookSelect = {
  key: true,
  category: true,
  title: true,
  summary: true,
  introduction: true,
  content: true,
  steps: true,
  safetyNotes: true,
  active: true,
  sortOrder: true,
  isBuiltin: true,
  updatedAt: true,
  deletedAt: true,
} satisfies Prisma.SupportPlaybookSelect;

export async function listAvailableSupportPlaybooks(actor: Actor) {
  assertAllowed(actor.isStaff);
  return withActorDb(actor, async (tx) => {
    const rows = await tx.supportPlaybook.findMany({
      where: { active: true, deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
      select: playbookSelect,
    });
    return rows.map((row) => {
      const playbook = parseRecord(row);
      return {
        key: playbook.key,
        category: playbook.category,
        title: playbook.title,
        summary: playbook.summary,
        introduction: playbook.introduction,
        ...(playbook.content ? { content: playbook.content } : {}),
        steps: playbook.steps,
        safetyNotes: playbook.safetyNotes,
      };
    });
  });
}

export async function listSupportPlaybooksForAdmin(actor: Actor) {
  assertAllowed(actor.isPlatformAdmin);
  return withActorDb(actor, async (tx) => {
    const rows = await tx.supportPlaybook.findMany({
      orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
      select: playbookSelect,
    });
    return rows.map(parseRecord);
  });
}

export async function findActiveSupportPlaybook(
  tx: Prisma.TransactionClient,
  key: string,
) {
  const row = await tx.supportPlaybook.findFirst({
    where: { key, active: true, deletedAt: null },
    select: playbookSelect,
  });
  return row ? parseRecord(row) : null;
}

export async function createSupportPlaybook(
  actor: Actor,
  input: CreateSupportPlaybookInput,
) {
  assertAllowed(actor.isPlatformAdmin);
  const content = normalizePlaybookContent(input.content);
  await withActorDb(actor, async (tx) => {
    const created = await tx.supportPlaybook.create({
      data: {
        category: input.category,
        title: input.title,
        summary: summarizePlaybookContent(content, 180),
        introduction: summarizePlaybookContent(content, 500),
        content,
        steps: ["请查看指南正文并按说明操作。"],
        safetyNotes: input.safetyNotes,
        active: input.active,
        sortOrder: input.sortOrder,
        isBuiltin: false,
        updatedById: actor.id,
      },
      select: { key: true },
    });
    await claimSupportPlaybookInlineAttachments(
      tx,
      actor,
      extractInlineAttachmentIds(content),
      created.key,
    );
    await writeAuditLog(tx, actor, {
      action: "SUPPORT_PLAYBOOK_CREATED",
      resourceType: "SupportPlaybook",
      resourceId: created.key,
      metadata: { title: input.title },
    });
  });
  return listSupportPlaybooksForAdmin(actor);
}

export async function updateSupportPlaybook(
  actor: Actor,
  key: string,
  input: UpdateSupportPlaybookInput,
) {
  assertAllowed(actor.isPlatformAdmin);
  const content =
    input.content === undefined ? undefined : normalizePlaybookContent(input.content);
  await withActorDb(actor, async (tx) => {
    const current = await tx.supportPlaybook.findUnique({
      where: { key },
      select: { key: true },
    });
    if (!current) {
      throw new DomainError(
        "SUPPORT_PLAYBOOK_NOT_FOUND",
        "处理指南不存在",
        404,
      );
    }
    await tx.supportPlaybook.update({
      where: { key },
      data: {
        category: input.category,
        title: input.title,
        safetyNotes: input.safetyNotes,
        active: input.active,
        sortOrder: input.sortOrder,
        ...(content === undefined
          ? {}
          : {
              content,
              summary: summarizePlaybookContent(content, 180),
              introduction: summarizePlaybookContent(content, 500),
            }),
        updatedById: actor.id,
      },
    });
    if (content !== undefined) {
      await claimSupportPlaybookInlineAttachments(
        tx,
        actor,
        extractInlineAttachmentIds(content),
        key,
      );
    }
    await writeAuditLog(tx, actor, {
      action: "SUPPORT_PLAYBOOK_UPDATED",
      resourceType: "SupportPlaybook",
      resourceId: key,
      metadata: { fields: Object.keys(input) },
    });
  });
  return listSupportPlaybooksForAdmin(actor);
}

export async function deleteSupportPlaybook(actor: Actor, key: string) {
  assertAllowed(actor.isPlatformAdmin);
  await withActorDb(actor, async (tx) => {
    const current = await tx.supportPlaybook.findUnique({
      where: { key },
      select: { key: true, title: true, deletedAt: true },
    });
    if (!current) {
      throw new DomainError(
        "SUPPORT_PLAYBOOK_NOT_FOUND",
        "处理指南不存在",
        404,
      );
    }
    if (current.deletedAt) return;
    await tx.supportPlaybook.update({
      where: { key },
      data: { active: false, deletedAt: new Date(), updatedById: actor.id },
    });
    await writeAuditLog(tx, actor, {
      action: "SUPPORT_PLAYBOOK_ARCHIVED",
      resourceType: "SupportPlaybook",
      resourceId: key,
      metadata: { title: current.title },
    });
  });
  return listSupportPlaybooksForAdmin(actor);
}

export async function resetSupportPlaybook(actor: Actor, key: string) {
  assertAllowed(actor.isPlatformAdmin);
  const defaults = getDefaultSupportReplyPlaybook(key);
  if (!defaults) {
    throw new DomainError(
      "SUPPORT_PLAYBOOK_NOT_BUILTIN",
      "自定义指南没有系统默认内容",
      409,
    );
  }
  const defaultSortOrder = getDefaultSupportReplyPlaybookOrder(key) ?? 0;
  await withActorDb(actor, async (tx) => {
    const current = await tx.supportPlaybook.findUnique({
      where: { key },
      select: { isBuiltin: true },
    });
    if (!current?.isBuiltin) {
      throw new DomainError(
        "SUPPORT_PLAYBOOK_NOT_BUILTIN",
        "该指南不能恢复系统默认",
        409,
      );
    }
    await tx.supportPlaybook.update({
      where: { key },
      data: {
        category: defaults.category,
        title: defaults.title,
        summary: defaults.summary,
        introduction: defaults.introduction,
        content: buildDefaultSupportReplyPlaybookContent(defaults),
        steps: defaults.steps,
        safetyNotes: defaults.safetyNotes,
        active: true,
        deletedAt: null,
        sortOrder: defaultSortOrder,
        updatedById: actor.id,
      },
    });
    await writeAuditLog(tx, actor, {
      action: "SUPPORT_PLAYBOOK_RESET",
      resourceType: "SupportPlaybook",
      resourceId: key,
      metadata: { title: defaults.title },
    });
  });
  return listSupportPlaybooksForAdmin(actor);
}

export async function restoreSupportPlaybook(actor: Actor, key: string) {
  assertAllowed(actor.isPlatformAdmin);
  await withActorDb(actor, async (tx) => {
    const restored = await tx.supportPlaybook.updateMany({
      where: { key, deletedAt: { not: null } },
      data: { deletedAt: null, active: true, updatedById: actor.id },
    });
    if (restored.count !== 1) {
      throw new DomainError(
        "SUPPORT_PLAYBOOK_NOT_DELETED",
        "该指南不存在或未被删除",
        409,
      );
    }
    await writeAuditLog(tx, actor, {
      action: "SUPPORT_PLAYBOOK_RESTORED",
      resourceType: "SupportPlaybook",
      resourceId: key,
    });
  });
  return listSupportPlaybooksForAdmin(actor);
}

function normalizePlaybookContent(value: string) {
  const content = sanitizeMessageHtml(value);
  if (!hasMeaningfulHtml(content)) {
    throw new DomainError(
      "SUPPORT_PLAYBOOK_CONTENT_REQUIRED",
      "指南正文不能为空",
      422,
    );
  }
  return content;
}

function summarizePlaybookContent(content: string, maxLength: number) {
  return buildMessagePreview(content, maxLength) || "包含图片的处理指南";
}
