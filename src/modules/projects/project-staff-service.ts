import "server-only";

import type { Actor } from "@/lib/actor";
import type { NotificationDeliveryOverride } from "@/modules/notifications/notification-delivery-override";
import { withActorDb } from "@/lib/actor";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  dispatchProjectStaffActivity,
  publishDetachedProjectChange,
  publishProjectChange,
  previewProjectStaffRecipients,
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

const PROJECT_ROLE_LABELS: Record<AddProjectStaffInput["role"], string> = {
  PROJECT_MANAGER: "项目经理",
  TECHNICIAN: "技术人员",
};

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
  deliveryOverride?: NotificationDeliveryOverride,
) {
  return withActorDb(actor, async (tx) => {
    await assertCanManageProjectStaff(tx, actor, projectId);
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { id: true, customerSpaceId: true, title: true },
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
    await dispatchProjectStaffActivity(tx, actor, {
      change: "PROJECT_STAFF_SELF_ADDED",
      recipientUserId: input.userId,
      notificationTitle: `你已加入项目：${project.title}`,
      notificationBody: `你被添加为“${project.title}”的${PROJECT_ROLE_LABELS[input.role]}。`,
      customerSpaceId: project.customerSpaceId,
      projectId,
      deliveryOverride,
    });
    return staff;
  });
}

/** 发送前预览：只提醒当事人，所以收件人恒为被操作的那一位 */
export function previewProjectStaffDelivery(
  actor: Actor,
  projectId: string,
  targetUserId: string,
) {
  return withActorDb(actor, async (tx) => {
    await assertCanManageProjectStaff(tx, actor, projectId);
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { customerSpaceId: true },
    });
    assertFound(project, "项目不存在");
    // 目标必须落在「可加入本项目的内部人员」这个范围内，与 addProjectStaff 同口径。
    // 不校验的话，任何有项目人员管理权的员工都能拿已知 userId 构造预览，
    // 而预览会读出这个人的姓名、邮件总开关、按场景退订、微信绑定与额度 ——
    // 等于把预览接口变成跨用户的通知偏好查询入口。
    const target = await tx.user.findFirst({
      where: {
        id: targetUserId,
        deletedAt: null,
        platformRole: {
          in: ["PLATFORM_ADMIN", "PROJECT_MANAGER", "TECHNICIAN"],
        },
      },
      select: { id: true },
    });
    assertFound(target, "该账号不可加入项目");
    return previewProjectStaffRecipients(tx, actor, {
      recipientUserId: targetUserId,
      customerSpaceId: project.customerSpaceId,
      projectId,
    });
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
        project: { select: { customerSpaceId: true, title: true } },
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
    if (updated.role !== staff.role) {
      await dispatchProjectStaffActivity(tx, actor, {
        change: "PROJECT_STAFF_SELF_UPDATED",
        recipientUserId: staff.userId,
        notificationTitle: `项目角色已调整：${staff.project.title}`,
        notificationBody: `你在“${staff.project.title}”的角色已调整为${PROJECT_ROLE_LABELS[updated.role]}。`,
        customerSpaceId: staff.project.customerSpaceId,
        projectId,
      });
    }
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
        project: { select: { customerSpaceId: true, title: true } },
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
    // 必须赶在删除之前：Notification 的 RLS WITH CHECK 对非管理员要求
    // app_user_relevant_to_project(userId, projectId)，删完就插不进去了。
    await dispatchProjectStaffActivity(tx, actor, {
      change: "PROJECT_STAFF_SELF_REMOVED",
      recipientUserId: staff.userId,
      notificationTitle: `你已被移出项目：${staff.project.title}`,
      notificationBody: `你不再是“${staff.project.title}”的项目人员，相关工单分配已一并解除。`,
      customerSpaceId: staff.project.customerSpaceId,
      projectId,
    });
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
