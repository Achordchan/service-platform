import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import {
  assertAllowed,
  assertFound,
  DomainError,
} from "@/modules/projects/errors";
import type {
  DeletionCheck,
  DeletionImpact,
  DeletionReport,
  DeletionResourceType,
} from "@/modules/deletion/deletion-types";

type Tx = Prisma.TransactionClient;

export function getDeletionPreflight(
  actor: Actor,
  resourceType: DeletionResourceType,
  resourceId: string,
) {
  assertAllowed(actor.isPlatformAdmin);
  return withActorDb(actor, (tx) =>
    buildDeletionReport(tx, actor, resourceType, resourceId, false),
  );
}

export async function assertDeletionAllowedInTx(
  tx: Tx,
  actor: Actor,
  resourceType: DeletionResourceType,
  resourceId: string,
) {
  const report = await buildDeletionReport(
    tx,
    actor,
    resourceType,
    resourceId,
    true,
  );
  if (!report.allowed) {
    throw new DomainError(
      "DELETION_BLOCKED",
      "删除检测未通过，请先处理阻断项",
      409,
      report,
    );
  }
  return report;
}

async function buildDeletionReport(
  tx: Tx,
  actor: Actor,
  resourceType: DeletionResourceType,
  resourceId: string,
  lockTarget: boolean,
): Promise<DeletionReport> {
  if (lockTarget) {
    await lockDeletionTarget(tx, resourceType, resourceId);
  }
  const report =
    resourceType === "CUSTOMER_SPACE"
      ? await customerSpaceReport(tx, resourceId)
      : resourceType === "STAFF_USER"
        ? await staffUserReport(tx, actor, resourceId)
        : resourceType === "PROJECT"
          ? await projectReport(tx, resourceId)
          : resourceType === "SERVICE_TYPE"
            ? await serviceTypeReport(tx, resourceId)
            : resourceType === "REQUEST_CATEGORY"
              ? await requestCategoryReport(tx, resourceId)
              : await roleGroupReport(tx, resourceId);

  return {
    resourceType,
    resourceId,
    ...report,
    allowed: report.checks.every((check) => check.status !== "BLOCK"),
    checkedAt: new Date().toISOString(),
  };
}

async function customerSpaceReport(tx: Tx, resourceId: string) {
  const space = await tx.customerSpace.findUnique({
    where: { id: resourceId },
    select: {
      id: true,
      name: true,
      ownerId: true,
      _count: {
        select: {
          projects: true,
          memberships: true,
          invitations: true,
        },
      },
    },
  });
  assertFound(space, "客户空间不存在");
  const checks: DeletionCheck[] = [
    countCheck({
      key: "projects",
      label: "关联项目",
      count: space._count.projects,
      blocking: true,
      clearMessage: "没有关联项目",
      blockedMessage: `仍有 ${space._count.projects} 个项目，请先删除或转移项目`,
      actionHref: `/staff/projects?customerSpaceId=${space.id}`,
    }),
    impactCheck(
      "memberships",
      "客户成员关系",
      space._count.memberships,
      "删除客户后成员关系会一并移除",
    ),
    impactCheck(
      "invitations",
      "客户邀请",
      space._count.invitations,
      "删除客户后相关邀请会一并移除",
    ),
    {
      key: "owner-account",
      label: "负责人账号",
      status: "PASS",
      message: "负责人登录账号会保留，不会随客户空间删除",
    },
  ];
  return {
    resourceLabel: space.name,
    confirmationMode: "SIMPLE" as const,
    checks,
    impacts: [
      impact("memberships", "成员关系", space._count.memberships, "DELETE"),
      impact("invitations", "邀请记录", space._count.invitations, "DELETE"),
      impact("owner", "负责人账号", 1, "PRESERVE"),
    ],
  };
}

async function staffUserReport(tx: Tx, actor: Actor, resourceId: string) {
  const user = await tx.user.findUnique({
    where: { id: resourceId },
    select: {
      id: true,
      name: true,
      platformRole: true,
      _count: {
        select: {
          projectAssignments: true,
          requestsAssigned: true,
          requestAssignees: true,
          ownedSpaces: true,
          projectsCreated: true,
          milestonesCreated: true,
          projectUpdates: true,
          updateComments: true,
          requestsCreated: true,
          requestMessages: true,
          attachments: true,
        },
      },
    },
  });
  assertFound(user, "用户不存在");
  const assignmentCount =
    user._count.projectAssignments +
    user._count.requestsAssigned +
    user._count.requestAssignees;
  const historyCount =
    user._count.projectsCreated +
    user._count.milestonesCreated +
    user._count.projectUpdates +
    user._count.updateComments +
    user._count.requestsCreated +
    user._count.requestMessages +
    user._count.attachments;
  const checks: DeletionCheck[] = [
    booleanCheck(
      "self",
      "当前登录账号",
      user.id !== actor.id,
      "不是当前登录账号",
      "不能删除当前登录账号",
    ),
    booleanCheck(
      "platform-role",
      "账号角色",
      user.platformRole !== "PLATFORM_ADMIN",
      "账号不是平台管理员",
      "平台管理员账号不可删除",
    ),
    booleanCheck(
      "internal-user",
      "账号类型",
      user.platformRole !== "CUSTOMER",
      "账号属于内部协作人员",
      "该入口只能删除内部协作人员",
    ),
    countCheck({
      key: "owned-spaces",
      label: "负责的客户空间",
      count: user._count.ownedSpaces,
      blocking: true,
      clearMessage: "没有负责的客户空间",
      blockedMessage: `仍是 ${user._count.ownedSpaces} 个客户空间的负责人`,
      actionHref: "/staff/customers",
    }),
    countCheck({
      key: "assignments",
      label: "项目与工单分配",
      count: assignmentCount,
      blocking: true,
      clearMessage: "没有未解除的项目或工单分配",
      blockedMessage: `仍有 ${assignmentCount} 项项目或工单分配`,
      actionHref: "/staff/projects",
    }),
    countCheck({
      key: "history",
      label: "历史内容",
      count: historyCount,
      blocking: true,
      clearMessage: "没有需要保留作者关系的历史内容",
      blockedMessage: `存在 ${historyCount} 条历史内容，暂不支持物理删除`,
    }),
  ];
  return {
    resourceLabel: user.name,
    confirmationMode: "SIMPLE" as const,
    checks,
    impacts: [],
  };
}

async function projectReport(tx: Tx, resourceId: string) {
  const project = await tx.project.findUnique({
    where: { id: resourceId },
    select: {
      id: true,
      title: true,
      _count: {
        select: {
          requests: true,
          updates: true,
          milestones: true,
          attachments: true,
          staff: true,
          pluginBindings: true,
        },
      },
    },
  });
  assertFound(project, "项目不存在");
  const fileSize = await tx.attachment.aggregate({
    where: { projectId: resourceId },
    _sum: { size: true },
  });
  const externalContactCount = await tx.externalContact.count({
    where: { binding: { projectId: resourceId } },
  });
  const embedSessionCount = await tx.externalEmbedSession.count({
    where: { binding: { projectId: resourceId } },
  });
  const externalRequestCount = await tx.serviceRequest.count({
    where: {
      projectId: resourceId,
      createdByExternalContactId: { not: null },
    },
  });
  const checks: DeletionCheck[] = [
    {
      key: "project-cascade",
      label: "级联删除范围",
      status: "WARN",
      message: "项目删除后，请求、动态、里程碑、成员分配和附件均不可恢复",
    },
    impactCheck(
      "requests",
      "服务请求",
      project._count.requests,
      "服务请求及聊天记录会被删除",
    ),
    impactCheck(
      "updates",
      "项目动态",
      project._count.updates,
      "项目动态及评论会被删除",
    ),
    impactCheck(
      "milestones",
      "里程碑",
      project._count.milestones,
      "里程碑会被删除",
    ),
    impactCheck(
      "attachments",
      "附件",
      project._count.attachments,
      `附件文件会被删除，共 ${formatBytes(fileSize._sum.size ?? 0)}`,
    ),
    impactCheck(
      "plugin-bindings",
      "外部连接",
      project._count.pluginBindings,
      "项目连接配置会被删除，现有嵌入入口立即失效",
    ),
    impactCheck(
      "external-contacts",
      "外部联系人",
      externalContactCount,
      "外部联系人身份映射会被删除",
    ),
    impactCheck(
      "embed-sessions",
      "嵌入会话",
      embedSessionCount,
      "所有嵌入会话会立即失效",
    ),
  ];
  return {
    resourceLabel: project.title,
    confirmationMode: "TYPE_NAME" as const,
    checks,
    impacts: [
      impact("requests", "服务请求", project._count.requests, "DELETE"),
      impact("updates", "项目动态", project._count.updates, "DELETE"),
      impact("milestones", "里程碑", project._count.milestones, "DELETE"),
      impact("attachments", "附件", project._count.attachments, "DELETE"),
      impact("staff", "项目成员分配", project._count.staff, "DELETE"),
      impact(
        "plugin-bindings",
        "外部连接",
        project._count.pluginBindings,
        "DELETE",
      ),
      impact("external-contacts", "外部联系人", externalContactCount, "DELETE"),
      impact("embed-sessions", "嵌入会话", embedSessionCount, "DELETE"),
      impact("external-requests", "外部工单", externalRequestCount, "DELETE"),
    ],
  };
}

async function serviceTypeReport(tx: Tx, resourceId: string) {
  const serviceType = await tx.serviceType.findUnique({
    where: { id: resourceId },
    select: {
      id: true,
      name: true,
      _count: {
        select: {
          projects: true,
          requestCategories: true,
        },
      },
    },
  });
  assertFound(serviceType, "服务类型不存在");
  return {
    resourceLabel: serviceType.name,
    confirmationMode: "SIMPLE" as const,
    checks: [
      countCheck({
        key: "projects",
        label: "使用该类型的项目",
        count: serviceType._count.projects,
        blocking: true,
        clearMessage: "没有项目使用该服务类型",
        blockedMessage: `仍有 ${serviceType._count.projects} 个项目使用该类型`,
        actionHref: `/staff/projects?serviceTypeId=${serviceType.id}`,
      }),
      impactCheck(
        "categories",
        "请求分类",
        serviceType._count.requestCategories,
        "删除服务类型后，请求分类会一并删除",
      ),
    ],
    impacts: [
      impact(
        "categories",
        "请求分类",
        serviceType._count.requestCategories,
        "DELETE",
      ),
    ],
  };
}

async function requestCategoryReport(tx: Tx, resourceId: string) {
  const category = await tx.requestCategory.findUnique({
    where: { id: resourceId },
    select: {
      id: true,
      name: true,
      serviceTypeId: true,
      _count: { select: { requests: true } },
    },
  });
  assertFound(category, "请求分类不存在");
  return {
    resourceLabel: category.name,
    confirmationMode: "SIMPLE" as const,
    checks: [
      countCheck({
        key: "requests",
        label: "使用该分类的服务请求",
        count: category._count.requests,
        blocking: true,
        clearMessage: "没有服务请求使用该分类",
        blockedMessage: `仍有 ${category._count.requests} 个服务请求使用该分类`,
        actionHref: "/staff/requests",
      }),
    ],
    impacts: [],
  };
}

async function roleGroupReport(tx: Tx, resourceId: string) {
  const roleGroup = await tx.roleGroup.findUnique({
    where: { id: resourceId },
    select: {
      id: true,
      name: true,
      isSystem: true,
      _count: { select: { users: true } },
    },
  });
  assertFound(roleGroup, "角色组不存在");
  const pendingInvitationCount = await tx.staffInvitation.count({
    where: {
      roleGroupId: resourceId,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  return {
    resourceLabel: roleGroup.name,
    confirmationMode: "SIMPLE" as const,
    checks: [
      booleanCheck(
        "system",
        "系统角色",
        !roleGroup.isSystem,
        "不是系统内置角色",
        "系统角色不可删除，可改为停用",
      ),
      countCheck({
        key: "users",
        label: "角色组成员",
        count: roleGroup._count.users,
        blocking: true,
        clearMessage: "角色组下没有成员",
        blockedMessage: `仍有 ${roleGroup._count.users} 名成员，请先迁移`,
        actionHref: "/staff/team",
      }),
      countCheck({
        key: "invitations",
        label: "待处理邀请",
        count: pendingInvitationCount,
        blocking: true,
        clearMessage: "没有关联邀请",
        blockedMessage: `仍有 ${pendingInvitationCount} 条邀请，请先撤销或改组`,
        actionHref: "/staff/team",
      }),
    ],
    impacts: [],
  };
}

async function lockDeletionTarget(
  tx: Tx,
  resourceType: DeletionResourceType,
  resourceId: string,
) {
  if (resourceType === "CUSTOMER_SPACE") {
    await tx.$queryRaw`SELECT id FROM "CustomerSpace" WHERE id = ${resourceId} FOR UPDATE`;
    return;
  }
  if (resourceType === "STAFF_USER") {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${resourceId} FOR UPDATE`;
    return;
  }
  if (resourceType === "PROJECT") {
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${resourceId} FOR UPDATE`;
    return;
  }
  if (resourceType === "SERVICE_TYPE") {
    await tx.$queryRaw`SELECT id FROM "ServiceType" WHERE id = ${resourceId} FOR UPDATE`;
    return;
  }
  if (resourceType === "REQUEST_CATEGORY") {
    await tx.$queryRaw`SELECT id FROM "RequestCategory" WHERE id = ${resourceId} FOR UPDATE`;
    return;
  }
  await tx.$queryRaw`SELECT id FROM "RoleGroup" WHERE id = ${resourceId} FOR UPDATE`;
}

function booleanCheck(
  key: string,
  label: string,
  passed: boolean,
  clearMessage: string,
  blockedMessage: string,
): DeletionCheck {
  return {
    key,
    label,
    status: passed ? "PASS" : "BLOCK",
    message: passed ? clearMessage : blockedMessage,
  };
}

function countCheck(input: {
  key: string;
  label: string;
  count: number;
  blocking: boolean;
  clearMessage: string;
  blockedMessage: string;
  actionHref?: string;
}): DeletionCheck {
  const hasItems = input.count > 0;
  return {
    key: input.key,
    label: input.label,
    status: hasItems ? (input.blocking ? "BLOCK" : "WARN") : "PASS",
    message: hasItems ? input.blockedMessage : input.clearMessage,
    count: input.count,
    ...(hasItems && input.actionHref
      ? { actionHref: input.actionHref, actionLabel: "前往处理" }
      : {}),
  };
}

function impactCheck(
  key: string,
  label: string,
  count: number,
  message: string,
): DeletionCheck {
  return {
    key,
    label,
    status: count > 0 ? "WARN" : "PASS",
    count,
    message: count > 0 ? message : `没有${label}`,
  };
}

function impact(
  key: string,
  label: string,
  count: number,
  action: DeletionImpact["action"],
): DeletionImpact {
  return { key, label, count, action };
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
