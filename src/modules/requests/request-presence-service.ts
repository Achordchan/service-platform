import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import {
  publishEvent,
  publishTransientEvent,
} from "@/modules/notifications/notification-service";
import { badRequest, notFound } from "@/modules/requests/errors";
import { findRequestContext } from "@/modules/requests/request-context";
import type { RequestPresenceInput } from "@/modules/requests/request-schemas";

const PRESENCE_TTL_MS = 3 * 60 * 1000;
const STALE_RETENTION_MS = 24 * 60 * 60 * 1000;
const TYPING_TTL_MS = 12_000;

export type RequestPresenceGroup = "CUSTOMER" | "STAFF";

function actorGroup(actor: Actor): RequestPresenceGroup {
  return actor.platformRole === "CUSTOMER" ? "CUSTOMER" : "STAFF";
}

function groupUserWhere(group: RequestPresenceGroup): Prisma.UserWhereInput {
  return group === "CUSTOMER"
    ? { platformRole: "CUSTOMER" }
    : { platformRole: { not: "CUSTOMER" } };
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
) {
  return withActorDb(actor, async (tx) => {
    const request = await findRequestContext(tx, requestId, actor.id);
    if (!request) throw notFound();

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
        },
        update: {
          expiresAt: new Date(now.getTime() + PRESENCE_TTL_MS),
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
      counterpartOnline: counterpartUserIds.length > 0,
    };
  });
}
