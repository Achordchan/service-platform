import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { ExternalActor } from "@/lib/external-actor";
import { withExternalActorDb } from "@/lib/external-actor";
import type { embedPresenceSchema } from "@/modules/integrations/external/schemas";
import {
  publishEvent,
  publishTransientEvent,
} from "@/modules/notifications/notification-service";
import { DomainError } from "@/modules/projects/errors";
import type { z } from "zod";

const PRESENCE_TTL_MS = 3 * 60 * 1000;
const TYPING_TTL_MS = 12_000;
type PresenceInput = z.infer<typeof embedPresenceSchema>;

async function isCustomerGroupOnline(
  tx: Prisma.TransactionClient,
  serviceRequestId: string,
  now: Date,
) {
  const customerPresence = await tx.requestPresence.findFirst({
    where: {
      serviceRequestId,
      expiresAt: { gt: now },
      user: { platformRole: "CUSTOMER" },
    },
    select: { id: true },
  });
  const externalPresence = await tx.externalRequestPresence.findFirst({
    where: {
      serviceRequestId,
      expiresAt: { gt: now },
    },
    select: { id: true },
  });
  return Boolean(customerPresence || externalPresence);
}

export function updateExternalPresence(
  actor: ExternalActor,
  requestId: string,
  input: PresenceInput,
) {
  return withExternalActorDb(actor, async (tx) => {
    const request = await tx.serviceRequest.findFirst({
      where: {
        id: requestId,
        projectId: actor.projectId,
        createdByExternalContactId: actor.id,
      },
      select: {
        id: true,
        projectId: true,
        project: { select: { customerSpaceId: true } },
      },
    });
    if (!request) {
      throw new DomainError("REQUEST_NOT_FOUND", "工单不存在", 404);
    }
    const now = new Date();
    const wasOnline = await isCustomerGroupOnline(tx, request.id, now);
    // Drop expired presence rows opportunistically to keep the table bounded.
    await tx.externalRequestPresence.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    if (input.action === "heartbeat" || (input.action === "typing" && input.typing)) {
      await tx.externalRequestPresence.upsert({
        where: {
          serviceRequestId_externalContactId_sessionId: {
            serviceRequestId: request.id,
            externalContactId: actor.id,
            sessionId: input.sessionId,
          },
        },
        create: {
          serviceRequestId: request.id,
          externalContactId: actor.id,
          sessionId: input.sessionId,
          expiresAt: new Date(now.getTime() + PRESENCE_TTL_MS),
        },
        update: { expiresAt: new Date(now.getTime() + PRESENCE_TTL_MS) },
      });
      await tx.externalContact.update({
        where: { id: actor.id },
        data: { lastSeenAt: now },
      });
    } else if (input.action === "leave") {
      await tx.externalRequestPresence.deleteMany({
        where: {
          serviceRequestId: request.id,
          externalContactId: actor.id,
          sessionId: input.sessionId,
        },
      });
    }
    const isOnline = await isCustomerGroupOnline(tx, request.id, now);
    if (wasOnline !== isOnline) {
      await publishEvent(tx, {
        type: "REQUEST_PRESENCE_CHANGED",
        customerSpaceId: request.project.customerSpaceId,
        projectId: request.projectId,
        serviceRequestId: request.id,
        payload: {
          actorType: "EXTERNAL_CONTACT",
          actorId: actor.id,
          requestId: request.id,
          group: "CUSTOMER",
          online: isOnline,
        },
      });
    }
    const staffPresences = await tx.requestPresence.findMany({
      where: {
        serviceRequestId: request.id,
        expiresAt: { gt: now },
        user: { platformRole: { not: "CUSTOMER" } },
      },
      select: { userId: true },
    });
    const staffUserIds = Array.from(
      new Set(staffPresences.map((presence) => presence.userId)),
    );
    if (input.action === "typing") {
      await publishTransientEvent(tx, {
        type: "REQUEST_TYPING_CHANGED",
        userIds: staffUserIds,
        payload: {
          requestId: request.id,
          serviceRequestId: request.id,
          actorType: "EXTERNAL_CONTACT",
          actorId: actor.id,
          sessionId: input.sessionId,
          group: "CUSTOMER",
          typing: input.typing,
          visibility: "CUSTOMER_VISIBLE",
          expiresAt: new Date(
            now.getTime() + (input.typing ? TYPING_TTL_MS : 0),
          ).toISOString(),
        },
      });
    }
    return { counterpartOnline: staffUserIds.length > 0 };
  });
}
