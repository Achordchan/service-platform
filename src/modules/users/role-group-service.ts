import "server-only";

import { z } from "zod";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  DEFAULT_PERMISSIONS_BY_LEVEL,
  sanitizePermissions,
} from "@/modules/users/role-permissions";
import {
  assertAllowed,
  assertFound,
  DomainError,
} from "@/modules/projects/errors";

const createRoleGroupSchema = z.object({
  name: z.string().trim().min(2).max(60),
  key: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9_]+$/, "仅支持小写字母、数字和下划线")
    .optional(),
  description: z.string().trim().max(300).optional().or(z.literal("")),
  accessLevel: z.enum(["PROJECT_MANAGER", "TECHNICIAN"]),
  permissions: z.array(z.string()).default([]),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

const updateRoleGroupSchema = createRoleGroupSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "至少更新一个字段",
  });

export type CreateRoleGroupInput = z.infer<typeof createRoleGroupSchema>;
export type UpdateRoleGroupInput = z.infer<typeof updateRoleGroupSchema>;

function toKey(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

export function listRoleGroups(actor: Actor, options?: { activeOnly?: boolean }) {
  assertAllowed(actor.isPlatformAdmin || actor.isStaff);
  return withActorDb(actor, (tx) =>
    tx.roleGroup.findMany({
      where: options?.activeOnly ? { active: true } : undefined,
      include: {
        _count: {
          select: {
            users: true,
            invitations: true,
          },
        },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
  );
}

export function createRoleGroup(actor: Actor, raw: CreateRoleGroupInput) {
  assertAllowed(actor.isPlatformAdmin);
  const input = createRoleGroupSchema.parse(raw);
  const key = input.key?.trim() || toKey(input.name) || `role_${Date.now()}`;
  const permissions = sanitizePermissions(input.permissions, input.accessLevel);

  return withActorDb(actor, async (tx) => {
    const existing = await tx.roleGroup.findUnique({ where: { key } });
    if (existing) {
      throw new DomainError("ROLE_GROUP_KEY_EXISTS", "角色标识已存在", 409);
    }

    const created = await tx.roleGroup.create({
      data: {
        key,
        name: input.name,
        description: input.description?.trim() || null,
        accessLevel: input.accessLevel,
        permissions,
        active: input.active ?? true,
        sortOrder:
          input.sortOrder ??
          (input.accessLevel === "PROJECT_MANAGER" ? 50 : 60),
        isSystem: false,
      },
    });

    await writeAuditLog(tx, actor, {
      action: "ROLE_GROUP_CREATED",
      resourceType: "RoleGroup",
      resourceId: created.id,
      metadata: {
        key: created.key,
        accessLevel: created.accessLevel,
        permissions: created.permissions,
      },
    });

    return created;
  });
}

export function updateRoleGroup(
  actor: Actor,
  roleGroupId: string,
  raw: UpdateRoleGroupInput,
) {
  assertAllowed(actor.isPlatformAdmin);
  const input = updateRoleGroupSchema.parse(raw);

  return withActorDb(actor, async (tx) => {
    const existing = await tx.roleGroup.findUnique({
      where: { id: roleGroupId },
    });
    assertFound(existing, "角色组不存在");

    if (existing.isSystem && input.key && input.key !== existing.key) {
      throw new DomainError(
        "SYSTEM_ROLE_KEY_LOCKED",
        "系统角色标识不可修改",
        409,
      );
    }

    if (input.key && input.key !== existing.key) {
      const conflict = await tx.roleGroup.findUnique({
        where: { key: input.key },
      });
      if (conflict) {
        throw new DomainError("ROLE_GROUP_KEY_EXISTS", "角色标识已存在", 409);
      }
    }

    const accessLevel = input.accessLevel ?? existing.accessLevel;
    const permissions = input.permissions
      ? sanitizePermissions(input.permissions, accessLevel)
      : sanitizePermissions(existing.permissions, accessLevel);

    const updated = await tx.roleGroup.update({
      where: { id: roleGroupId },
      data: {
        name: input.name?.trim() || undefined,
        key: input.key?.trim() || undefined,
        description:
          input.description === undefined
            ? undefined
            : input.description.trim() || null,
        accessLevel: input.accessLevel,
        permissions,
        active: input.active,
        sortOrder: input.sortOrder,
      },
    });

    // Keep platformRole aligned for assigned users when access level changes.
    if (input.accessLevel && input.accessLevel !== existing.accessLevel) {
      await tx.user.updateMany({
        where: {
          roleGroupId,
          platformRole: {
            in: ["PROJECT_MANAGER", "TECHNICIAN"],
          },
        },
        data: {
          platformRole: input.accessLevel,
        },
      });
    }

    await writeAuditLog(tx, actor, {
      action: "ROLE_GROUP_UPDATED",
      resourceType: "RoleGroup",
      resourceId: roleGroupId,
      metadata: {
        accessLevel: updated.accessLevel,
        permissions: updated.permissions,
        active: updated.active,
      },
    });

    return updated;
  });
}

export function deleteRoleGroup(actor: Actor, roleGroupId: string) {
  assertAllowed(actor.isPlatformAdmin);
  return withActorDb(actor, async (tx) => {
    const existing = await tx.roleGroup.findUnique({
      where: { id: roleGroupId },
      include: {
        _count: {
          select: {
            users: true,
            invitations: true,
          },
        },
      },
    });
    assertFound(existing, "角色组不存在");
    if (existing.isSystem) {
      throw new DomainError(
        "SYSTEM_ROLE_LOCKED",
        "系统角色不可删除，可改为停用",
        409,
      );
    }
    if (existing._count.users > 0 || existing._count.invitations > 0) {
      throw new DomainError(
        "ROLE_GROUP_IN_USE",
        "角色组仍有成员或待处理邀请，请先迁移后再删除",
        409,
      );
    }

    await tx.roleGroup.delete({ where: { id: roleGroupId } });
    await writeAuditLog(tx, actor, {
      action: "ROLE_GROUP_DELETED",
      resourceType: "RoleGroup",
      resourceId: roleGroupId,
      metadata: { key: existing.key, name: existing.name },
    });
  });
}

export function getDefaultPermissions(accessLevel: "PROJECT_MANAGER" | "TECHNICIAN") {
  return [...DEFAULT_PERMISSIONS_BY_LEVEL[accessLevel]];
}
