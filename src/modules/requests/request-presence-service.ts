import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { publishEvent } from "@/modules/notifications/notification-service";
import { notFound } from "@/modules/requests/errors";
import { findRequestContext } from "@/modules/requests/request-context";
import type { RequestPresenceInput } from "@/modules/requests/request-schemas";

const PRESENCE_TTL_MS = 70_000;
const STALE_RETENTION_MS = 24 * 60 * 60 * 1000;

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

    if (input.action === "heartbeat") {
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
    } else {
      await tx.requestPresence.deleteMany({
        where: {
          serviceRequestId: request.id,
          userId: actor.id,
          sessionId: input.sessionId,
        },
      });
    }

    await tx.requestPresence.deleteMany({
      where: {
        serviceRequestId: request.id,
        expiresAt: {
          lt: new Date(now.getTime() - STALE_RETENTION_MS),
        },
      },
    });

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

    return {
      counterpartOnline: await isGroupOnline(
        tx,
        request.id,
        counterpartGroup,
        now,
      ),
    };
  });
}
