import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { writeAuditLog } from "@/modules/audit/audit-service";
import type { externalContactPatchSchema } from "@/modules/integrations/external/schemas";
import {
  getRegisteredPlugin,
  listRegisteredExternalConnectors,
} from "@/modules/plugins/plugin-registry";
import { assertFound, DomainError } from "@/modules/projects/errors";
import { assertCanManageProjectDelivery } from "@/modules/projects/project-access";
import type { z } from "zod";

type ContactPatchInput = z.infer<typeof externalContactPatchSchema>;

type ContactListInput = {
  keyword?: string;
  status?: "ACTIVE" | "BLOCKED";
  cursor?: string;
  limit: number;
};

function encodeCursor(value: { id: string; lastSeenAt: Date }) {
  return Buffer.from(
    JSON.stringify({ id: value.id, lastSeenAt: value.lastSeenAt.toISOString() }),
  ).toString("base64url");
}

function decodeCursor(value?: string) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      id?: unknown;
      lastSeenAt?: unknown;
    };
    const lastSeenAt = new Date(String(parsed.lastSeenAt ?? ""));
    if (typeof parsed.id !== "string" || Number.isNaN(lastSeenAt.getTime())) {
      throw new Error("invalid cursor");
    }
    return { id: parsed.id, lastSeenAt };
  } catch {
    throw new DomainError("EXTERNAL_CONTACT_CURSOR_INVALID", "联系人分页参数无效", 422);
  }
}

async function loadExternalBinding(
  tx: Prisma.TransactionClient,
  projectId: string,
) {
  const pluginKeys = listRegisteredExternalConnectors().map(
    (manifest) => manifest.key,
  );
  const binding = await tx.projectPluginBinding.findFirst({
    where: { projectId, pluginKey: { in: pluginKeys } },
    include: {
      project: { select: { customerSpaceId: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  assertFound(binding, "外部连接不存在");
  return binding;
}

const contactSelect = {
  id: true,
  externalUserId: true,
  email: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  profileAttributes: true,
  status: true,
  firstSeenAt: true,
  lastSeenAt: true,
  _count: { select: { requestsCreated: true } },
} as const;

export async function listExternalContacts(
  actor: Actor,
  projectId: string,
  input: ContactListInput,
) {
  return withActorDb(actor, async (tx) => {
    await assertCanManageProjectDelivery(tx, actor, projectId);
    const binding = await loadExternalBinding(tx, projectId);
    const cursor = decodeCursor(input.cursor);
    const keyword = input.keyword?.trim();
    const filters: Prisma.ExternalContactWhereInput[] = [];
    if (keyword) {
      filters.push({
        OR: [
          { displayName: { contains: keyword, mode: "insensitive" } },
          { email: { contains: keyword, mode: "insensitive" } },
          { username: { contains: keyword, mode: "insensitive" } },
          { externalUserId: { contains: keyword, mode: "insensitive" } },
        ],
      });
    }
    if (cursor) {
      filters.push({
        OR: [
          { lastSeenAt: { lt: cursor.lastSeenAt } },
          { lastSeenAt: cursor.lastSeenAt, id: { lt: cursor.id } },
        ],
      });
    }
    const contacts = await tx.externalContact.findMany({
      where: {
        bindingId: binding.id,
        ...(input.status ? { status: input.status } : {}),
        ...(filters.length > 0 ? { AND: filters } : {}),
      },
      select: contactSelect,
      orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
    });
    const sourceLabel = getRegisteredPlugin(binding.pluginKey).manifest.name;
    const hasMore = contacts.length > input.limit;
    const page = hasMore ? contacts.slice(0, input.limit) : contacts;
    const items = page.map((contact) => ({
      ...contact,
      sourceKey: binding.pluginKey,
      sourceLabel,
    }));
    return {
      items,
      nextCursor:
        hasMore && page.length > 0 ? encodeCursor(page[page.length - 1]) : null,
    };
  });
}

export async function updateExternalContact(
  actor: Actor,
  projectId: string,
  contactId: string,
  input: ContactPatchInput,
) {
  return withActorDb(actor, async (tx) => {
    await assertCanManageProjectDelivery(tx, actor, projectId);
    const binding = await loadExternalBinding(tx, projectId);
    const contact = await tx.externalContact.findFirst({
      where: { id: contactId, bindingId: binding.id },
    });
    assertFound(contact, "外部联系人不存在");
    const updated = await tx.externalContact.update({
      where: { id: contact.id },
      data: { status: input.status },
      select: contactSelect,
    });
    if (input.status === "BLOCKED") {
      await tx.externalEmbedSession.updateMany({
        where: { externalContactId: contact.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await writeAuditLog(tx, actor, {
      action: "EXTERNAL_CONTACT_STATUS_UPDATED",
      resourceType: "ExternalContact",
      resourceId: contact.id,
      customerSpaceId: binding.project.customerSpaceId,
      projectId,
      metadata: {
        status: input.status,
        externalUserId: contact.externalUserId,
        source: binding.pluginKey,
      },
    });
    return {
      ...updated,
      sourceKey: binding.pluginKey,
      sourceLabel: getRegisteredPlugin(binding.pluginKey).manifest.name,
    };
  });
}
