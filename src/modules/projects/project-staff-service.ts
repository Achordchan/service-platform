import "server-only";

import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  publishDetachedProjectChange,
  publishProjectChange,
} from "@/modules/notifications/notification-service";
import {
  assertCanManageProjectStaff,
  assertCanViewProject,
} from "@/modules/projects/project-access";
import {
  assertFound,
  DomainError,
} from "@/modules/projects/errors";
import type {
  AddProjectStaffInput,
  UpdateProjectStaffInput,
} from "@/modules/projects/schemas";

const staffUserSelect = {
  id: true,
  name: true,
  email: true,
  platformRole: true,
} as const;

function assertRoleMatches(
  platformRole: string,
  projectRole: AddProjectStaffInput["role"],
) {
  const expectedPlatformRole =
    projectRole === "PROJECT_MANAGER" ? "PROJECT_MANAGER" : "TECHNICIAN";
  if (
    platformRole !== expectedPlatformRole &&
    platformRole !== "PLATFORM_ADMIN"
  ) {
    throw new DomainError(
      "PROJECT_STAFF_ROLE_MISMATCH",
      "用户平台角色与项目角色不匹配",
      409,
    );
  }
}

export function listProjectStaff(actor: Actor, projectId: string) {
  return withActorDb(actor, async (tx) => {
    await assertCanViewProject(tx, actor, projectId);
    return tx.projectStaff.findMany({
      where: { projectId },
      include: {
        user: {
          select: actor.isStaff
            ? staffUserSelect
            : {
                id: true,
                name: true,
              },
        },
      },
      orderBy: { createdAt: "asc" },
    });
  });
}

export function addProjectStaff(
  actor: Actor,
  projectId: string,
  input: AddProjectStaffInput,
) {
  return withActorDb(actor, async (tx) => {
    await assertCanManageProjectStaff(tx, actor, projectId);
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { id: true, customerSpaceId: true },
    });
    const user = await tx.user.findUnique({
      where: { id: input.userId },
      select: { id: true, platformRole: true, deletedAt: true },
    });
    const duplicate = await tx.projectStaff.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId: input.userId,
        },
      },
      select: { id: true },
    });
    assertFound(project, "项目不存在");
    assertFound(user, "用户不存在");
    if (user.deletedAt) {
      throw new DomainError("USER_NOT_FOUND", "用户不存在", 404);
    }
    if (duplicate) {
      throw new DomainError(
        "PROJECT_STAFF_EXISTS",
        "该人员已在项目中",
        409,
      );
    }
    assertRoleMatches(user.platformRole, input.role);

    const staff = await tx.projectStaff.create({
      data: { projectId, ...input },
      include: { user: { select: staffUserSelect } },
    });
    await writeAuditLog(tx, actor, {
      action: "PROJECT_STAFF_ADDED",
      resourceType: "ProjectStaff",
      resourceId: staff.id,
      customerSpaceId: project.customerSpaceId,
      projectId,
      metadata: input,
    });
    await publishProjectChange(tx, actor, {
      change: "PROJECT_STAFF_ADDED",
      customerSpaceId: project.customerSpaceId,
      projectId,
      payload: { projectStaffId: staff.id, userId: input.userId },
    });
    return staff;
  });
}

export function updateProjectStaff(
  actor: Actor,
  projectId: string,
  projectStaffId: string,
  input: UpdateProjectStaffInput,
) {
  return withActorDb(actor, async (tx) => {
    await assertCanManageProjectStaff(tx, actor, projectId);
    const staff = await tx.projectStaff.findFirst({
      where: { id: projectStaffId, projectId },
      include: {
        project: { select: { customerSpaceId: true } },
        user: { select: { platformRole: true, deletedAt: true } },
      },
    });
    assertFound(staff, "项目人员不存在");
    if (staff.user.deletedAt) {
      throw new DomainError("PROJECT_STAFF_DELETED", "该项目成员已删除", 409);
    }
    assertRoleMatches(staff.user.platformRole, input.role);

    const updated = await tx.projectStaff.update({
      where: { id: projectStaffId },
      data: input,
      include: { user: { select: staffUserSelect } },
    });
    await writeAuditLog(tx, actor, {
      action: "PROJECT_STAFF_UPDATED",
      resourceType: "ProjectStaff",
      resourceId: updated.id,
      customerSpaceId: staff.project.customerSpaceId,
      projectId,
      metadata: input,
    });
    await publishProjectChange(tx, actor, {
      change: "PROJECT_STAFF_UPDATED",
      customerSpaceId: staff.project.customerSpaceId,
      projectId,
      payload: { projectStaffId: updated.id, userId: staff.userId },
    });
    return updated;
  });
}

export function removeProjectStaff(
  actor: Actor,
  projectId: string,
  projectStaffId: string,
) {
  return withActorDb(actor, async (tx) => {
    await assertCanManageProjectStaff(tx, actor, projectId);
    const staff = await tx.projectStaff.findFirst({
      where: { id: projectStaffId, projectId },
      include: {
        project: { select: { customerSpaceId: true } },
      },
    });
    assertFound(staff, "项目人员不存在");

    const affectedRequests = await tx.serviceRequest.findMany({
      where: {
        projectId,
        OR: [
          { assigneeId: staff.userId },
          { assignees: { some: { userId: staff.userId } } },
        ],
      },
      select: { id: true, assigneeId: true },
    });
    await tx.requestAssignee.deleteMany({
      where: {
        userId: staff.userId,
        serviceRequest: { projectId },
      },
    });
    for (const request of affectedRequests) {
      if (request.assigneeId !== staff.userId) continue;
      const nextAssignee = await tx.requestAssignee.findFirst({
        where: { serviceRequestId: request.id },
        select: { userId: true },
        orderBy: { assignedAt: "asc" },
      });
      await tx.serviceRequest.update({
        where: { id: request.id },
        data: { assigneeId: nextAssignee?.userId ?? null },
      });
    }
    await tx.projectStaff.delete({ where: { id: projectStaffId } });
    await writeAuditLog(tx, actor, {
      action: "PROJECT_STAFF_REMOVED",
      resourceType: "ProjectStaff",
      resourceId: projectStaffId,
      customerSpaceId: staff.project.customerSpaceId,
      projectId,
      metadata: {
        userId: staff.userId,
        role: staff.role,
        clearedRequestAssignments: affectedRequests.length,
      },
    });
    await publishProjectChange(tx, actor, {
      change: "PROJECT_STAFF_REMOVED",
      customerSpaceId: staff.project.customerSpaceId,
      projectId,
      payload: { projectStaffId, userId: staff.userId },
    });
    await publishDetachedProjectChange(tx, actor, {
      change: "PROJECT_ACCESS_REVOKED",
      projectId,
      userIds: [staff.userId],
      payload: { projectStaffId },
    });
  });
}
