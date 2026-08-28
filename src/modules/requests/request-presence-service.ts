import "server-only";

import type { PresenceClient, Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import {
  publishEvent,
  publishTransientEvent,
} from "@/modules/notifications/notification-service";
import { badRequest, notFound } from "@/modules/requests/errors";
import {
  describeUserAgent,
  resolveIpLocation,
} from "@/modules/http/client-context";
import {
  canAccessCustomerRequestModule,
  findRequestContext,
} from "@/modules/requests/request-context";
import type { RequestPresenceInput } from "@/modules/requests/request-schemas";

const PRESENCE_TTL_MS = 3 * 60 * 1000;
const STALE_RETENTION_MS = 24 * 60 * 60 * 1000;
const TYPING_TTL_MS = 12_000;

export type RequestPresenceGroup = "CUSTOMER" | "STAFF";

export type PresenceNetwork = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

function actorGroup(actor: Actor): RequestPresenceGroup {
  return actor.platformRole === "CUSTOMER" ? "CUSTOMER" : "STAFF";
}

function groupUserWhere(group: RequestPresenceGroup): Prisma.UserWhereInput {
  return group === "CUSTOMER"
    ? { platformRole: "CUSTOMER" }
    : { platformRole: { not: "CUSTOMER" } };
}

/** 该分组当前在线的端集合（用于在线标识旁的图标区分） */
async function onlineClients(
  tx: Prisma.TransactionClient,
  serviceRequestId: string,
  group: RequestPresenceGroup,
  now: Date,
) {
  const rows = await tx.requestPresence.findMany({
    where: {
      serviceRequestId,
      expiresAt: { gt: now },
      user: groupUserWhere(group),
    },
    select: { client: true },
    distinct: ["client"],
  });
  return rows.map((row) => row.client);
}

async function isGroupOnline(
  tx: Prisma.TransactionClient,
  serviceRequestId: string,
  group: RequestPresenceGroup,
  now: Date,
) {
  const presence = await tx.requestPresence.findFirst({
    where: {
      serviceRequestId,
      expiresAt: { gt: now },
      user: groupUserWhere(group),
    },
    select: { id: true },
  });
  const externalPresence =
    group === "CUSTOMER"
      ? await tx.externalRequestPresence.findFirst({
          where: {
            serviceRequestId,
            expiresAt: { gt: now },
          },
          select: { id: true },
        })
      : null;
  return Boolean(presence || externalPresence);
}

async function isExternalCustomerOnline(
  tx: Prisma.TransactionClient,
  serviceRequestId: string,
  now: Date,
) {
  const presence = await tx.externalRequestPresence.findFirst({
    where: {
      serviceRequestId,
      expiresAt: { gt: now },
    },
    select: { id: true },
  });
  return Boolean(presence);
}

async function publishPresenceChange(
  tx: Prisma.TransactionClient,
  actor: Actor,
  request: NonNullable<Awaited<ReturnType<typeof findRequestContext>>>,
  group: RequestPresenceGroup,
  online: boolean,
) {
  await publishEvent(tx, {
    type: "REQUEST_PRESENCE_CHANGED",
    customerSpaceId: request.project.customerSpaceId,
    projectId: request.projectId,
    serviceRequestId: request.id,
    payload: {
      requestId: request.id,
      actorId: actor.id,
      group,
      online,
    },
  });
}

async function activeGroupUserIds(
  tx: Prisma.TransactionClient,
  serviceRequestId: string,
  group: RequestPresenceGroup,
  now: Date,
) {
  const presences = await tx.requestPresence.findMany({
    where: {
      serviceRequestId,
      expiresAt: { gt: now },
      user: groupUserWhere(group),
    },
    select: { userId: true },
  });
  return Array.from(new Set(presences.map((presence) => presence.userId)));
}

export function updateRequestPresence(
  actor: Actor,
  requestId: string,
  input: RequestPresenceInput,
  network?: PresenceNetwork,
) {
  return withActorDb(actor, async (tx) => {
    const request = await findRequestContext(tx, requestId, actor.id);
    if (!request) throw notFound();
    if (!canAccessCustomerRequestModule(actor, request)) throw notFound();

    const now = new Date();
    const ownGroup = actorGroup(actor);
    const counterpartGroup =
      ownGroup === "CUSTOMER" ? ("STAFF" as const) : ("CUSTOMER" as const);
    const groupWasOnline = await isGroupOnline(
      tx,
      request.id,
      ownGroup,
      now,
    );

    if (
      input.action === "heartbeat" ||
      input.action === "typing" && input.typing
    ) {
      await tx.requestPresence.upsert({
        where: {
          serviceRequestId_userId_sessionId: {
            serviceRequestId: request.id,
            userId: actor.id,
            sessionId: input.sessionId,
          },
        },
        create: {
          serviceRequestId: request.id,
          userId: actor.id,
          sessionId: input.sessionId,
          expiresAt: new Date(now.getTime() + PRESENCE_TTL_MS),
          client: input.client ?? "WEB",
          timezone: input.timezone ?? null,
          userAgent: network?.userAgent ?? null,
          ipAddress: network?.ipAddress ?? null,
        },
        update: {
          expiresAt: new Date(now.getTime() + PRESENCE_TTL_MS),
          client: input.client ?? "WEB",
          ...(input.timezone ? { timezone: input.timezone } : {}),
          ...(network?.userAgent ? { userAgent: network.userAgent } : {}),
          ...(network?.ipAddress ? { ipAddress: network.ipAddress } : {}),
        },
      });
    } else if (input.action === "leave") {
      await tx.requestPresence.deleteMany({
        where: {
          serviceRequestId: request.id,
          userId: actor.id,
          sessionId: input.sessionId,
        },
      });
    }

    if (input.action !== "typing") {
      await tx.requestPresence.deleteMany({
        where: {
          serviceRequestId: request.id,
          expiresAt: {
            lt: new Date(now.getTime() - STALE_RETENTION_MS),
          },
        },
      });
    }

    const groupIsOnline = await isGroupOnline(
      tx,
      request.id,
      ownGroup,
      now,
    );
    if (groupWasOnline !== groupIsOnline) {
      await publishPresenceChange(
        tx,
        actor,
        request,
        ownGroup,
        groupIsOnline,
      );
    }

    const counterpartUserIds = await activeGroupUserIds(
      tx,
      request.id,
      counterpartGroup,
      now,
    );
    const externalCounterpartOnline =
      counterpartGroup === "CUSTOMER"
        ? await isExternalCustomerOnline(tx, request.id, now)
        : false;
    if (input.action === "typing") {
      const visibility = input.visibility;
      if (
        actor.platformRole === "CUSTOMER" &&
        visibility !== "CUSTOMER_VISIBLE"
      ) {
        throw badRequest(
          "INVALID_TYPING_VISIBILITY",
          "客户输入状态只能用于公开回复",
        );
      }
      if (visibility === "CUSTOMER_VISIBLE") {
        await publishTransientEvent(tx, {
          type: "REQUEST_TYPING_CHANGED",
          userIds: counterpartUserIds,
          externalContactIds:
            actor.isStaff && request.createdByExternalContactId
              ? [request.createdByExternalContactId]
              : [],
          payload: {
            requestId: request.id,
            serviceRequestId: request.id,
            actorId: actor.id,
            sessionId: input.sessionId,
            group: ownGroup,
            typing: input.typing === true,
            visibility,
            expiresAt: new Date(
              now.getTime() + (input.typing ? TYPING_TTL_MS : 0),
            ).toISOString(),
          },
        });
      }
    }

    return {
      counterpartOnline:
        counterpartUserIds.length > 0 || externalCounterpartOnline,
      // 对方在线来自哪些端：外部联系人走邮件门户，统一记为 WEB
      counterpartClients: [
        ...new Set([
          ...(await onlineClients(tx, request.id, counterpartGroup, now)),
          ...(externalCounterpartOnline ? (["WEB"] as const) : []),
        ]),
      ],
    };
  });
}

/**
 * 客户端上下文（设备 / 时区 / IP 归属地）—— 仅后台人员可读。
 *
 * 数据来自在线心跳留下的 RequestPresence 行：UA 与 IP 由服务端从请求头取，
 * 时区由客户端提供。这些信息不放在「客户在线」标识旁（那个是常驻的），
 * 而是作为工单详情里的一个入口按需查看。
 *
 * 外部门户（Sub2API / 通用外部接入）的联系人不是平台用户，心跳写在
 * ExternalRequestPresence，UA 与 IP 记在它对应的 ExternalEmbedSession 上。
 * 只查 RequestPresence 的话，工单的真正提交者会整个缺席 —— 明明有人正在看，
 * 却显示「还没有打开过这个工单」。两边合并后按最近活跃排序。
 */
export function listRequestClientContexts(actor: Actor, requestId: string) {
  return withActorDb(actor, async (tx) => {
    if (!actor.isStaff) throw notFound();
    const request = await findRequestContext(tx, requestId, actor.id);
    if (!request) throw notFound();
    if (!canAccessCustomerRequestModule(actor, request)) throw notFound();

    const rows = await tx.requestPresence.findMany({
      where: {
        serviceRequestId: requestId,
        user: { platformRole: "CUSTOMER" },
      },
      select: {
        id: true,
        client: true,
        userAgent: true,
        timezone: true,
        ipAddress: true,
        expiresAt: true,
        updatedAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
    });
    const externalRows = await tx.externalRequestPresence.findMany({
      where: { serviceRequestId: requestId },
      select: {
        id: true,
        sessionId: true,
        expiresAt: true,
        updatedAt: true,
        externalContact: {
          select: { id: true, displayName: true, email: true },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
    });
    // sessionId 就是 ExternalEmbedSession.id：UA / IP 记在会话上
    const sessions = externalRows.length
      ? await tx.externalEmbedSession.findMany({
          where: { id: { in: externalRows.map((row) => row.sessionId) } },
          select: { id: true, ipAddress: true, userAgent: true },
        })
      : [];
    const sessionById = new Map(sessions.map((item) => [item.id, item]));

    const now = new Date();
    const describe = (input: {
      id: string;
      user: { id: string; name: string; email: string | null };
      client: PresenceClient;
      expiresAt: Date;
      updatedAt: Date;
      timezone: string | null;
      ipAddress: string | null;
      userAgent: string | null;
      external?: boolean;
    }) => ({
      id: input.id,
      user: input.user,
      client: input.client,
      online: input.expiresAt.getTime() > now.getTime(),
      lastSeenAt: input.updatedAt.toISOString(),
      timezone: input.timezone,
      ipAddress: input.ipAddress,
      ipLocation: resolveIpLocation(input.ipAddress),
      device: describeUserAgent(input.userAgent),
      userAgent: input.userAgent,
      /** 外部门户联系人（非平台用户），UI 需要区分标注 */
      external: input.external ?? false,
    });

    return [
      ...rows.map((row) => describe({ ...row, timezone: row.timezone })),
      ...externalRows.map((row) => {
        const session = sessionById.get(row.sessionId);
        return describe({
          id: row.id,
          user: {
            id: row.externalContact.id,
            name: row.externalContact.displayName,
            email: row.externalContact.email,
          },
          // 外部门户只有网页
          client: "WEB",
          expiresAt: row.expiresAt,
          updatedAt: row.updatedAt,
          // 外部门户不上报时区
          timezone: null,
          ipAddress: session?.ipAddress ?? null,
          userAgent: session?.userAgent ?? null,
          external: true,
        });
      }),
    ]
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
      .slice(0, 20);
  });
}
