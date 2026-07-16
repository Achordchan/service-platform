import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { removePrivateFile } from "@/modules/attachments/private-storage";
import { assertDeletionAllowedInTx } from "@/modules/deletion/deletion-service";
import {
  publishProjectChange,
  publishProjectDeleted,
} from "@/modules/notifications/notification-service";
import {
  assertAllowed,
  assertFound,
  DomainError,
} from "@/modules/projects/errors";
import { assertCanViewProject } from "@/modules/projects/project-access";
import { calculateProjectProgress } from "@/modules/projects/progress";
import type {
  CreateProjectInput,
  UpdateProjectInput,
} from "@/modules/projects/schemas";

function auditMetadata(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function projectWhereFor(actor: Actor): Prisma.ProjectWhereInput {
  if (actor.isPlatformAdmin) return {};
  if (actor.isStaff) {
    return { staff: { some: { userId: actor.id } } };
  }
  return {
    customerSpace: {
      memberships: { some: { userId: actor.id } },
    },
  };
}

const projectSummaryInclude = {
  customerSpace: {
    select: { id: true, name: true, slug: true, status: true },
  },
  serviceType: {
    select: {
      id: true,
      key: true,
      name: true,
      requestCategories: {
        where: { active: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      },
    },
  },
  staff: {
    where: { role: "PROJECT_MANAGER" as const },
    select: {
      role: true,
      user: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: { createdAt: "asc" as const },
  },
  milestones: {
    select: { status: true },
  },
  _count: {
    select: { staff: true, updates: true, requests: true },
  },
} as const;

export function listProjects(actor: Actor) {
  return withActorDb(actor, async (tx) => {
    const projects = await tx.project.findMany({
      where: projectWhereFor(actor),
      include: projectSummaryInclude,
      orderBy: { updatedAt: "desc" },
    });

    return projects.map(({ milestones, ...project }) => {
      const progress = calculateProjectProgress(milestones);
      return {
        ...project,
        progress: progress.percentage,
        progressDetails: progress.counts,
      };
    });
  });
}

export function getProject(actor: Actor, projectId: string) {
  return withActorDb(actor, async (tx) => {
    await assertCanViewProject(tx, actor, projectId);
    const project = await tx.project.findUnique({
      where: { id: projectId },
      include: {
        customerSpace: {
          select: { id: true, name: true, slug: true, status: true },
        },
        serviceType: {
          select: {
            id: true,
            key: true,
            name: true,
            requestCategories: {
              where: { active: true },
              select: { id: true, name: true },
              orderBy: { name: "asc" },
            },
          },
        },
        staff: {
          include: {
            user: {
              select: actor.isStaff
                ? {
                    id: true,
                    name: true,
                    email: true,
                    platformRole: true,
                  }
                : {
                    id: true,
                    name: true,
                  },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        milestones: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        },
        updates: {
          where: actor.isStaff
            ? undefined
            : { visibility: "CUSTOMER_VISIBLE" },
          include: {
            author: {
              select: { id: true, name: true },
            },
            comments: {
              where: actor.isStaff
                ? undefined
                : { visibility: "CUSTOMER_VISIBLE" },
              include: {
                author: {
                  select: { id: true, name: true },
                },
              },
              orderBy: { createdAt: "asc" },
            },
          },
          orderBy: { createdAt: "desc" },
        },
        attachments: {
          where: {
            projectUpdateId: null,
            updateCommentId: null,
            serviceRequestId: null,
            requestMessageId: null,
            ...(actor.isStaff
              ? {}
              : { visibility: "CUSTOMER_VISIBLE" as const }),
          },
          select: {
            id: true,
            originalName: true,
            mimeType: true,
            size: true,
            visibility: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    assertFound(project, "项目不存在");
    const progress = calculateProjectProgress(project.milestones);
    return {
      ...project,
      progress: progress.percentage,
      progressDetails: progress.counts,
    };
  });
}

export function createProject(actor: Actor, input: CreateProjectInput) {
  assertAllowed(actor.isPlatformAdmin);
  return withActorDb(actor, async (tx) => {
    const customerSpace = await tx.customerSpace.findUnique({
      where: { id: input.customerSpaceId },
      select: { id: true, status: true },
    });
    const serviceType = await tx.serviceType.findUnique({
      where: { id: input.serviceTypeId },
      select: { id: true, active: true },
    });
    assertFound(customerSpace, "客户空间不存在");
    assertFound(serviceType, "服务类型不存在");
    if (customerSpace.status !== "ACTIVE") {
      throw new DomainError(
        "CUSTOMER_SPACE_NOT_ACTIVE",
        "只能为启用中的客户空间创建项目",
        409,
      );
    }
    if (!serviceType.active) {
      throw new DomainError(
        "SERVICE_TYPE_NOT_ACTIVE",
        "只能使用已启用的服务类型",
        409,
      );
    }

    const { managerUserIds, ...projectInput } = input;
    const project = await tx.project.create({
      data: {
        ...projectInput,
        createdById: actor.id,
      },
      include: projectSummaryInclude,
    });

    const selectedManagerIds = Array.from(
      new Set(
        (managerUserIds && managerUserIds.length > 0
          ? managerUserIds
          : [actor.id]
        ).filter(Boolean),
      ),
    );

    for (const userId of selectedManagerIds) {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, platformRole: true },
      });
      if (!user) {
        throw new DomainError("USER_NOT_FOUND", "项目负责人不存在", 404);
      }
      if (
        user.platformRole !== "PLATFORM_ADMIN" &&
        user.platformRole !== "PROJECT_MANAGER"
      ) {
        throw new DomainError(
          "INVALID_PROJECT_MANAGER",
          "只能把平台管理员或项目负责人设为项目负责人",
          409,
        );
      }
      await tx.projectStaff.create({
        data: {
          projectId: project.id,
          userId: user.id,
          role: "PROJECT_MANAGER",
        },
      });
    }

    await writeAuditLog(tx, actor, {
      action: "PROJECT_CREATED",
      resourceType: "Project",
      resourceId: project.id,
      customerSpaceId: project.customerSpaceId,
      projectId: project.id,
      metadata: auditMetadata({
        ...projectInput,
        managerUserIds: selectedManagerIds,
      }),
    });
    await publishProjectChange(tx, actor, {
      change: "PROJECT_CREATED",
      customerSpaceId: project.customerSpaceId,
      projectId: project.id,
    });

    const { milestones, ...result } = project;
    const progress = calculateProjectProgress(milestones);
    return {
      ...result,
      progress: progress.percentage,
      progressDetails: progress.counts,
    };
  });
}

export function updateProject(
  actor: Actor,
  projectId: string,
  input: UpdateProjectInput,
) {
  assertAllowed(actor.isPlatformAdmin);
  return withActorDb(actor, async (tx) => {
    const existing = await tx.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        customerSpaceId: true,
        startDate: true,
        endDate: true,
      },
    });
    assertFound(existing, "项目不存在");

    const startDate =
      input.startDate === undefined
        ? existing.startDate
        : input.startDate
          ? new Date(input.startDate)
          : null;
    const endDate =
      input.endDate === undefined
        ? existing.endDate
        : input.endDate
          ? new Date(input.endDate)
          : null;
    if (startDate && endDate && endDate < startDate) {
      throw new DomainError(
        "INVALID_DATE_RANGE",
        "结束日期不能早于开始日期",
        422,
      );
    }

    const project = await tx.project.update({
      where: { id: projectId },
      data: input,
      include: projectSummaryInclude,
    });
    await writeAuditLog(tx, actor, {
      action: "PROJECT_UPDATED",
      resourceType: "Project",
      resourceId: project.id,
      customerSpaceId: project.customerSpaceId,
      projectId: project.id,
      metadata: auditMetadata(input),
    });
    await publishProjectChange(tx, actor, {
      change: "PROJECT_UPDATED",
      customerSpaceId: project.customerSpaceId,
      projectId: project.id,
    });

    const { milestones, ...result } = project;
    const progress = calculateProjectProgress(milestones);
    return {
      ...result,
      progress: progress.percentage,
      progressDetails: progress.counts,
    };
  });
}

export async function deleteProject(actor: Actor, projectId: string) {
  assertAllowed(actor.isPlatformAdmin);
  const storageKeys = await withActorDb(actor, async (tx) => {
    await assertDeletionAllowedInTx(tx, actor, "PROJECT", projectId);
    const existing = await tx.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        title: true,
        customerSpaceId: true,
        _count: {
          select: {
            requests: true,
            updates: true,
            milestones: true,
          },
        },
      },
    });
    assertFound(existing, "项目不存在");
    const attachments = await tx.attachment.findMany({
      where: { projectId },
      select: { storageKey: true },
    });

    await writeAuditLog(tx, actor, {
      action: "PROJECT_DELETED",
      resourceType: "Project",
      resourceId: existing.id,
      customerSpaceId: existing.customerSpaceId,
      projectId: existing.id,
      metadata: {
        title: existing.title,
        requestCount: existing._count.requests,
        updateCount: existing._count.updates,
        milestoneCount: existing._count.milestones,
      },
    });
    await publishProjectDeleted(tx, actor, projectId);
    await tx.project.delete({ where: { id: projectId } });
    return attachments.map((attachment) => attachment.storageKey);
  });

  let failedCount = 0;
  for (const storageKey of storageKeys) {
    try {
      await removePrivateFile(storageKey);
    } catch {
      failedCount += 1;
    }
  }
  if (failedCount > 0) {
    console.error("PROJECT_ATTACHMENT_FILE_DELETE_FAILED", {
      projectId,
      failedCount,
    });
  }
}
