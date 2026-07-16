import "server-only";

import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  assertAllowed,
  assertFound,
  DomainError,
} from "@/modules/projects/errors";
import type {
  CreateRequestCategoryInput,
  CreateServiceTypeInput,
  UpdateRequestCategoryInput,
  UpdateServiceTypeInput,
} from "@/modules/projects/schemas";
import { assertDeletionAllowedInTx } from "@/modules/deletion/deletion-service";

export function listServiceTypes(actor: Actor) {
  assertAllowed(actor.isPlatformAdmin);
  return withActorDb(actor, (tx) =>
    tx.serviceType.findMany({
      include: {
        requestCategories: {
          orderBy: { name: "asc" },
        },
      },
      orderBy: { name: "asc" },
    }),
  );
}

export function getServiceType(actor: Actor, serviceTypeId: string) {
  assertAllowed(actor.isPlatformAdmin);
  return withActorDb(actor, async (tx) => {
    const serviceType = await tx.serviceType.findUnique({
      where: { id: serviceTypeId },
      include: {
        requestCategories: {
          orderBy: { name: "asc" },
        },
      },
    });
    assertFound(serviceType, "服务类型不存在");
    return serviceType;
  });
}

export function createServiceType(
  actor: Actor,
  input: CreateServiceTypeInput,
) {
  assertAllowed(actor.isPlatformAdmin);
  return withActorDb(actor, async (tx) => {
    const duplicate = await tx.serviceType.findUnique({
      where: { key: input.key },
      select: { id: true },
    });
    if (duplicate) {
      throw new DomainError(
        "SERVICE_TYPE_KEY_CONFLICT",
        "服务类型标识已存在",
        409,
      );
    }

    const serviceType = await tx.serviceType.create({ data: input });
    await writeAuditLog(tx, actor, {
      action: "SERVICE_TYPE_CREATED",
      resourceType: "ServiceType",
      resourceId: serviceType.id,
      metadata: { key: serviceType.key, name: serviceType.name },
    });
    return serviceType;
  });
}

export function updateServiceType(
  actor: Actor,
  serviceTypeId: string,
  input: UpdateServiceTypeInput,
) {
  assertAllowed(actor.isPlatformAdmin);
  return withActorDb(actor, async (tx) => {
    const existing = await tx.serviceType.findUnique({
      where: { id: serviceTypeId },
      select: { id: true },
    });
    assertFound(existing, "服务类型不存在");

    const serviceType = await tx.serviceType.update({
      where: { id: serviceTypeId },
      data: input,
    });
    await writeAuditLog(tx, actor, {
      action: "SERVICE_TYPE_UPDATED",
      resourceType: "ServiceType",
      resourceId: serviceType.id,
      metadata: input,
    });
    return serviceType;
  });
}

export function listRequestCategories(
  actor: Actor,
  serviceTypeId: string,
) {
  assertAllowed(actor.isPlatformAdmin);
  return withActorDb(actor, async (tx) => {
    const serviceType = await tx.serviceType.findUnique({
      where: { id: serviceTypeId },
      select: { id: true },
    });
    assertFound(serviceType, "服务类型不存在");
    return tx.requestCategory.findMany({
      where: { serviceTypeId },
      orderBy: { name: "asc" },
    });
  });
}

export function createRequestCategory(
  actor: Actor,
  serviceTypeId: string,
  input: CreateRequestCategoryInput,
) {
  assertAllowed(actor.isPlatformAdmin);
  return withActorDb(actor, async (tx) => {
    const serviceType = await tx.serviceType.findUnique({
      where: { id: serviceTypeId },
      select: { id: true },
    });
    assertFound(serviceType, "服务类型不存在");

    const duplicate = await tx.requestCategory.findUnique({
      where: {
        serviceTypeId_name: {
          serviceTypeId,
          name: input.name,
        },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new DomainError(
        "REQUEST_CATEGORY_CONFLICT",
        "该服务类型下已存在同名请求分类",
        409,
      );
    }

    const category = await tx.requestCategory.create({
      data: {
        ...input,
        serviceTypeId,
      },
    });
    await writeAuditLog(tx, actor, {
      action: "REQUEST_CATEGORY_CREATED",
      resourceType: "RequestCategory",
      resourceId: category.id,
      metadata: {
        serviceTypeId,
        name: category.name,
      },
    });
    return category;
  });
}

export function updateRequestCategory(
  actor: Actor,
  serviceTypeId: string,
  requestCategoryId: string,
  input: UpdateRequestCategoryInput,
) {
  assertAllowed(actor.isPlatformAdmin);
  return withActorDb(actor, async (tx) => {
    const existing = await tx.requestCategory.findFirst({
      where: {
        id: requestCategoryId,
        serviceTypeId,
      },
      select: { id: true, name: true },
    });
    assertFound(existing, "请求分类不存在");

    if (input.name && input.name !== existing.name) {
      const duplicate = await tx.requestCategory.findUnique({
        where: {
          serviceTypeId_name: {
            serviceTypeId,
            name: input.name,
          },
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new DomainError(
          "REQUEST_CATEGORY_CONFLICT",
          "该服务类型下已存在同名请求分类",
          409,
        );
      }
    }

    const category = await tx.requestCategory.update({
      where: { id: requestCategoryId },
      data: input,
    });
    await writeAuditLog(tx, actor, {
      action: "REQUEST_CATEGORY_UPDATED",
      resourceType: "RequestCategory",
      resourceId: category.id,
      metadata: {
        serviceTypeId,
        ...input,
      },
    });
    return category;
  });
}

export function deleteServiceType(actor: Actor, serviceTypeId: string) {
  assertAllowed(actor.isPlatformAdmin);
  return withActorDb(actor, async (tx) => {
    await assertDeletionAllowedInTx(
      tx,
      actor,
      "SERVICE_TYPE",
      serviceTypeId,
    );
    const existing = await tx.serviceType.findUnique({
      where: { id: serviceTypeId },
      select: {
        id: true,
        key: true,
        name: true,
        _count: {
          select: {
            projects: true,
            requestCategories: true,
          },
        },
      },
    });
    assertFound(existing, "服务类型不存在");
    await tx.requestCategory.deleteMany({ where: { serviceTypeId } });
    await tx.serviceType.delete({ where: { id: serviceTypeId } });
    await writeAuditLog(tx, actor, {
      action: "SERVICE_TYPE_DELETED",
      resourceType: "ServiceType",
      resourceId: existing.id,
      metadata: {
        key: existing.key,
        name: existing.name,
        categoryCount: existing._count.requestCategories,
      },
    });
  });
}

export function deleteRequestCategory(
  actor: Actor,
  serviceTypeId: string,
  requestCategoryId: string,
) {
  assertAllowed(actor.isPlatformAdmin);
  return withActorDb(actor, async (tx) => {
    await assertDeletionAllowedInTx(
      tx,
      actor,
      "REQUEST_CATEGORY",
      requestCategoryId,
    );
    const existing = await tx.requestCategory.findFirst({
      where: {
        id: requestCategoryId,
        serviceTypeId,
      },
      select: {
        id: true,
        name: true,
        _count: { select: { requests: true } },
      },
    });
    assertFound(existing, "请求分类不存在");
    await tx.requestCategory.delete({ where: { id: requestCategoryId } });
    await writeAuditLog(tx, actor, {
      action: "REQUEST_CATEGORY_DELETED",
      resourceType: "RequestCategory",
      resourceId: existing.id,
      metadata: {
        serviceTypeId,
        name: existing.name,
      },
    });
  });
}
