import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import type { ExternalActor } from "@/lib/external-actor";

type AuditInput = {
  action: string;
  resourceType: string;
  resourceId?: string;
  result?: string;
  metadata?: Prisma.InputJsonValue;
  customerSpaceId?: string;
  projectId?: string;
  serviceRequestId?: string;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
};

export function writeAuditLog(
  tx: Prisma.TransactionClient,
  actor: Actor,
  input: AuditInput,
) {
  return tx.auditLog.createMany({
    data: [{
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      result: input.result ?? "SUCCESS",
      metadata: input.metadata,
      customerSpaceId: input.customerSpaceId,
      projectId: input.projectId,
      serviceRequestId: input.serviceRequestId,
      requestId: input.requestId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      actorId: actor.id === "system" ? undefined : actor.id,
    }],
  });
}

export function writeExternalAuditLog(
  tx: Prisma.TransactionClient,
  actor: ExternalActor,
  input: AuditInput,
) {
  return tx.auditLog.createMany({
    data: [{
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      result: input.result ?? "SUCCESS",
      metadata: input.metadata,
      customerSpaceId: input.customerSpaceId ?? actor.customerSpaceId,
      projectId: input.projectId ?? actor.projectId,
      serviceRequestId: input.serviceRequestId,
      requestId: input.requestId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      externalActorId: actor.id,
    }],
  });
}
