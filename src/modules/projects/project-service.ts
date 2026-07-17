import "server-only";

import { randomUUID } from "node:crypto";
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
import { ensurePluginInstallations } from "@/modules/plugins/plugin-installation-service";
import { SUB2API_CONNECTOR_PLUGIN_KEY } from "@/modules/plugins/plugin-registry";
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

export async function createProject(actor: Actor, input: CreateProjectInput) {
  assertAllowed(actor.isPlatformAdmin);
  const kind = input.kind ?? "STANDARD";
  if (kind === "EXTERNAL_INTEGRATION") {
    await ensurePluginInstallations();
  }
  return withActorDb(actor, async (tx) => {
    if (kind === "EXTERNAL_INTEGRATION") {
      const plugin = await tx.pluginInstallation.findUnique({
        where: { key: SUB2API_CONNECTOR_PLUGIN_KEY },
        select: { enabled: true, healthStatus: true },
      });
      if (!plugin?.enabled || plugin.healthStatus !== "READY") {
        throw new DomainError(
          "SUB2API_PLUGIN_NOT_READY",
          "请先在插件中心完成 Sub2API 连接器检测并启用",
          409,
        );
      }
    }
    const serviceType = await tx.serviceType.findUnique({
      where: { id: input.serviceTypeId },
      select: { id: true, active: true },
    });
    assertFound(serviceType, "服务类型不存在");
    if (!serviceType.active) {
      throw new DomainError(
        "SERVICE_TYPE_NOT_ACTIVE",
        "只能使用已启用的服务类型",
        409,
      );
    }

    const {
      managerUserIds,
      customerSpaceId: requestedCustomerSpaceId,
      ...projectInput
    } = input;
    let customerSpace: { id: string; status: "ACTIVE" | "SUSPENDED" | "ARCHIVED" };
    if (kind === "EXTERNAL_INTEGRATION") {
      customerSpace = await tx.customerSpace.create({
        data: {
          name: `Sub2API · ${input.title}`,
          slug: `external-${randomUUID()}`,
          kind: "EXTERNAL_MANAGED",
          memberLimit: 0,
          status: "ACTIVE",
          ownerId: actor.id,
        },
        select: { id: true, status: true },
      });
    } else {
      assertFound(requestedCustomerSpaceId, "请选择客户");
      const standardSpace = await tx.customerSpace.findFirst({
        where: { id: requestedCustomerSpaceId, kind: "STANDARD" },
        select: { id: true, status: true },
      });
      assertFound(standardSpace, "客户空间不存在");
      customerSpace = standardSpace;
      if (customerSpace.status !== "ACTIVE") {
        throw new DomainError(
          "CUSTOMER_SPACE_NOT_ACTIVE",
          "只能为启用中的客户空间创建项目",
          409,
        );
      }
    }
    const project = await tx.project.create({
      data: {
        ...projectInput,
        kind,
        customerSpaceId: customerSpace.id,
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
        kind,
        customerSpaceMode:
          kind === "EXTERNAL_INTEGRATION" ? "EXTERNAL_MANAGED" : "STANDARD",
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
        title: true,
        customerSpaceId: true,
        customerSpace: { select: { kind: true } },
        startDate: true,
        endDate: true,
        kind: true,
        _count: {
          select: {
            requests: true,
            updates: true,
            milestones: true,
            attachments: true,
            pluginBindings: true,
          },
        },
      },
    });
    assertFound(existing, "项目不存在");

    if (input.kind && input.kind !== existing.kind) {
      const businessDataCount =
        existing._count.requests +
        existing._count.updates +
        existing._count.milestones +
        existing._count.attachments +
        existing._count.pluginBindings;
      if (businessDataCount > 0) {
        throw new DomainError(
          "PROJECT_KIND_CHANGE_BLOCKED",
          "项目已有业务数据，不能修改项目类型",
          409,
          {
            checks: {
              requests: existing._count.requests,
              updates: existing._count.updates,
              milestones: existing._count.milestones,
              attachments: existing._count.attachments,
              pluginBindings: existing._count.pluginBindings,
            },
          },
        );
      }
      if (input.kind === "EXTERNAL_INTEGRATION") {
        const plugin = await tx.pluginInstallation.findUnique({
          where: { key: SUB2API_CONNECTOR_PLUGIN_KEY },
          select: { enabled: true, healthStatus: true },
        });
        if (!plugin?.enabled || plugin.healthStatus !== "READY") {
          throw new DomainError(
            "SUB2API_PLUGIN_NOT_READY",
            "请先在插件中心完成 Sub2API 连接器检测并启用",
            409,
          );
        }
      } else if (existing.kind === "EXTERNAL_INTEGRATION") {
        throw new DomainError(
          "PROJECT_KIND_CHANGE_REQUIRES_CUSTOMER",
          "外部接入项目不能直接转为标准项目，请新建标准项目并选择客户",
          409,
        );
      }
    }

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

    let managedCustomerSpaceId: string | undefined;
    if (
      input.kind === "EXTERNAL_INTEGRATION" &&
      existing.kind !== "EXTERNAL_INTEGRATION"
    ) {
      const managedSpace = await tx.customerSpace.create({
        data: {
          name: `Sub2API · ${input.title ?? existing.title}`,
          slug: `external-${randomUUID()}`,
          kind: "EXTERNAL_MANAGED",
          memberLimit: 0,
          status: "ACTIVE",
          ownerId: actor.id,
        },
        select: { id: true },
      });
      managedCustomerSpaceId = managedSpace.id;
    }

    const project = await tx.project.update({
      where: { id: projectId },
      data: {
        ...input,
        ...(managedCustomerSpaceId
          ? { customerSpaceId: managedCustomerSpaceId }
          : {}),
      },
      include: projectSummaryInclude,
    });
    if (
      input.title &&
      existing.customerSpace.kind === "EXTERNAL_MANAGED" &&
      !managedCustomerSpaceId
    ) {
      await tx.customerSpace.update({
        where: { id: existing.customerSpaceId },
        data: { name: `Sub2API · ${input.title}` },
      });
    }
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
        customerSpace: { select: { kind: true } },
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
    if (existing.customerSpace.kind === "EXTERNAL_MANAGED") {
      await tx.customerSpace.delete({
        where: { id: existing.customerSpaceId },
      });
    }
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
