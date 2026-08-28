import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { hasRolePermission } from "@/modules/authorization/role-permission-policy";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { removePrivateFile } from "@/modules/attachments/private-storage";
import { assertDeletionAllowedInTx } from "@/modules/deletion/deletion-service";
import {
  dispatchProjectCreatedActivity,
  publishProjectChange,
  publishProjectDeleted,
} from "@/modules/notifications/notification-service";
import {
  assertAllowed,
  assertFound,
  DomainError,
} from "@/modules/projects/errors";
import { assertCanViewProject } from "@/modules/projects/project-access";
import {
  hydrateProjectSummaries,
  projectBaseSelect,
} from "@/modules/projects/project-summary-query";
import { loadProjectDetail } from "@/modules/projects/project-detail-query";
import { listProjectCustomerUserIds } from "@/modules/projects/project-customer-recipient-query";
import { ensurePluginInstallations } from "@/modules/plugins/plugin-installation-service";
import {
  getRegisteredPlugin,
  listRegisteredExternalConnectors,
} from "@/modules/plugins/plugin-registry";
import type {
  CreateProjectInput,
  UpdateProjectInput,
} from "@/modules/projects/schemas";

function auditMetadata(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function connectorSpaceLabel(pluginKey: string) {
  return getRegisteredPlugin(pluginKey).manifest.name.replace(
    /\s*(?:工单|服务请求)连接器$/,
    "",
  );
}

async function resolveReadyExternalConnector(
  tx: Prisma.TransactionClient,
  requestedPluginKey?: string,
) {
  const registered = listRegisteredExternalConnectors();
  const allowedKeys = registered.map((manifest) => manifest.key);
  if (requestedPluginKey && !allowedKeys.includes(requestedPluginKey)) {
    throw new DomainError(
      "EXTERNAL_CONNECTOR_INVALID",
      "所选外部连接器不存在",
      422,
    );
  }
  const installations = await tx.pluginInstallation.findMany({
    where: {
      key: { in: requestedPluginKey ? [requestedPluginKey] : allowedKeys },
      enabled: true,
      healthStatus: "READY",
    },
    select: { key: true },
  });
  if (requestedPluginKey) {
    if (!installations.some((item) => item.key === requestedPluginKey)) {
      throw new DomainError(
        "EXTERNAL_CONNECTOR_NOT_READY",
        "所选外部连接器尚未完成检测并启用",
        409,
      );
    }
    return requestedPluginKey;
  }
  if (installations.length !== 1) {
    throw new DomainError(
      "EXTERNAL_CONNECTOR_REQUIRED",
      installations.length === 0
        ? "请先在插件中心检测并启用外部连接器"
        : "请选择该项目使用的外部连接器",
      409,
    );
  }
  return installations[0].key;
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

export function listProjects(actor: Actor) {
  return withActorDb(actor, async (tx) => {
    if (actor.isStaff && !hasRolePermission(actor, "project.view")) {
      return [];
    }
    const projects = await tx.project.findMany({
      where: projectWhereFor(actor),
      select: projectBaseSelect,
      orderBy: { updatedAt: "desc" },
    });
    const summaries = await hydrateProjectSummaries(tx, projects, actor);
    if (actor.isStaff) return summaries;
    return summaries.map((project) => ({
      ...project,
      progress: project.showProgress ? project.progress : 0,
      progressDetails: project.showProgress
        ? project.progressDetails
        : { total: 0, completed: 0, inProgress: 0, notStarted: 0 },
      serviceType: {
        ...project.serviceType,
        requestCategories: project.customerRequestsEnabled
          ? project.serviceType.requestCategories
          : [],
      },
      _count: {
        ...project._count,
        updates: project.customerUpdatesEnabled
          ? project._count.updates
          : 0,
        requests: project.customerRequestsEnabled
          ? project._count.requests
          : 0,
      },
    }));
  });
}

export function getProject(actor: Actor, projectId: string) {
  return withActorDb(actor, async (tx) => {
    await assertCanViewProject(tx, actor, projectId);
    const project = await loadProjectDetail(tx, actor, projectId);
    assertFound(project, "项目不存在");
    return project;
  });
}

export async function createProject(actor: Actor, input: CreateProjectInput) {
  assertAllowed(actor.isPlatformAdmin);
  const kind = input.kind ?? "STANDARD";
  if (kind === "EXTERNAL_INTEGRATION") {
    await ensurePluginInstallations();
  }
  return withActorDb(actor, async (tx) => {
    const connectorPluginKey =
      kind === "EXTERNAL_INTEGRATION"
        ? await resolveReadyExternalConnector(tx, input.connectorPluginKey)
        : null;
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
    delete projectInput.connectorPluginKey;
    let customerSpace: { id: string; status: "ACTIVE" | "SUSPENDED" | "ARCHIVED" };
    if (kind === "EXTERNAL_INTEGRATION") {
      customerSpace = await tx.customerSpace.create({
        data: {
          name: `${connectorSpaceLabel(connectorPluginKey!)} · ${input.title}`,
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
        status: kind === "STANDARD" ? "ACTIVE" : "DRAFT",
        currentStage: null,
        customerSpaceId: customerSpace.id,
        createdById: actor.id,
      },
    });
    if (connectorPluginKey) {
      await tx.projectPluginBinding.create({
        data: {
          projectId: project.id,
          pluginKey: connectorPluginKey,
          externalConnectorSlot: "PRIMARY",
          status: "DRAFT",
        },
      });
    }

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
        select: { id: true, platformRole: true, deletedAt: true },
      });
      if (!user || user.deletedAt) {
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
    await dispatchProjectCreatedActivity(tx, actor, {
      customerSpaceId: project.customerSpaceId,
      projectId: project.id,
      projectTitle: project.title,
      standardProject: kind === "STANDARD",
    });

    const [result] = await hydrateProjectSummaries(tx, [project], actor);
    return result;
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
        customerSpace: { select: { kind: true, name: true } },
        startDate: true,
        endDate: true,
        kind: true,
        status: true,
        pluginBindings: { select: { pluginKey: true } },
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

    if (input.status === "DRAFT") {
      throw new DomainError(
        "PROJECT_DRAFT_STATUS_MANAGED",
        "项目不能手动改为草稿状态",
        409,
      );
    }
    if (
      existing.kind === "EXTERNAL_INTEGRATION" &&
      existing.status === "DRAFT" &&
      input.status !== undefined
    ) {
      throw new DomainError(
        "EXTERNAL_PROJECT_NOT_ACTIVATED",
        "请先完成外部连接检测并激活连接",
        409,
      );
    }

    const existingConnectorPluginKey = existing.pluginBindings[0]?.pluginKey;
    if (
      input.connectorPluginKey &&
      existing.kind === "EXTERNAL_INTEGRATION" &&
      existingConnectorPluginKey &&
      input.connectorPluginKey !== existingConnectorPluginKey
    ) {
      throw new DomainError(
        "EXTERNAL_CONNECTOR_CHANGE_BLOCKED",
        "外部接入项目创建后不能更换连接器",
        409,
      );
    }

    let targetConnectorPluginKey: string | null = null;

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
        targetConnectorPluginKey = await resolveReadyExternalConnector(
          tx,
          input.connectorPluginKey,
        );
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
          name: `${connectorSpaceLabel(targetConnectorPluginKey!)} · ${input.title ?? existing.title}`,
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

    const projectUpdateInput = { ...input };
    delete projectUpdateInput.connectorPluginKey;
    const project = await tx.project.update({
      where: { id: projectId },
      data: {
        ...projectUpdateInput,
        ...(input.kind === "EXTERNAL_INTEGRATION" &&
        existing.kind !== "EXTERNAL_INTEGRATION"
          ? { status: "DRAFT" as const, currentStage: null }
          : {}),
        ...(managedCustomerSpaceId
          ? { customerSpaceId: managedCustomerSpaceId }
          : {}),
      },
    });
    if (targetConnectorPluginKey) {
      await tx.projectPluginBinding.create({
        data: {
          projectId,
          pluginKey: targetConnectorPluginKey,
          externalConnectorSlot: "PRIMARY",
          status: "DRAFT",
        },
      });
    }
    if (
      input.title &&
      existing.customerSpace.kind === "EXTERNAL_MANAGED" &&
      !managedCustomerSpaceId
    ) {
      await tx.customerSpace.update({
        where: { id: existing.customerSpaceId },
        data: {
          name: `${existingConnectorPluginKey
            ? connectorSpaceLabel(existingConnectorPluginKey)
            : existing.customerSpace.name.split(" · ")[0]} · ${input.title}`,
        },
      });
    }
    if (
      input.customerUpdatesEnabled === false ||
      input.customerRequestsEnabled === false ||
      input.customerFilesEnabled === false ||
      input.showProgress === false ||
      input.showMilestones === false
    ) {
      const customerUserIds = await listProjectCustomerUserIds(tx, projectId);
      const readAt = new Date();
      if (input.customerUpdatesEnabled === false) {
        await tx.notification.updateMany({
          where: {
            userId: { in: customerUserIds },
            projectId,
            readAt: null,
            type: { in: ["PROJECT_UPDATE", "UPDATE_COMMENT"] },
          },
          data: {
            readAt,
            aggregationKey: null,
            emailDueAt: null,
            emailClaimedAt: null,
          },
        });
      }
      if (input.customerRequestsEnabled === false) {
        await tx.notification.updateMany({
          where: {
            userId: { in: customerUserIds },
            projectId,
            readAt: null,
            type: {
              in: [
                "REQUEST_CREATED",
                "REQUEST_ASSIGNED",
                "REQUEST_CLAIMED",
                "REQUEST_MESSAGE",
                "REQUEST_STATUS",
                "REQUEST_ATTACHMENT",
                "REQUEST_ARCHIVE",
              ],
            },
          },
          data: {
            readAt,
            aggregationKey: null,
            emailDueAt: null,
            emailClaimedAt: null,
          },
        });
      }
      if (input.customerFilesEnabled === false) {
        await tx.notification.updateMany({
          where: {
            userId: { in: customerUserIds },
            projectId,
            readAt: null,
            type: "PROJECT_FILE",
          },
          data: { readAt, emailDueAt: null, emailClaimedAt: null },
        });
      }
      if (input.showProgress === false) {
        await tx.notification.updateMany({
          where: {
            userId: { in: customerUserIds },
            projectId,
            readAt: null,
            type: "PROJECT_STAGE",
          },
          data: { readAt, emailDueAt: null, emailClaimedAt: null },
        });
      }
      if (!project.showMilestones && !project.showProgress) {
        await tx.notification.updateMany({
          where: {
            userId: { in: customerUserIds },
            projectId,
            readAt: null,
            type: "PROJECT_MILESTONE",
          },
          data: { readAt, emailDueAt: null, emailClaimedAt: null },
        });
      }
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

    const [result] = await hydrateProjectSummaries(tx, [project], actor);
    return result;
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
      select: { storageKey: true, previewStorageKey: true },
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
    // AuditLog has multiple SET NULL cascade paths (project, request and
    // external actor). Clear the external actor first so PostgreSQL cannot
    // re-apply a stale contact id while deleting an external project graph.
    await tx.auditLog.updateMany({
      where: {
        externalActor: { binding: { projectId } },
      },
      data: { externalActorId: null },
    });
    await tx.project.delete({ where: { id: projectId } });
    if (existing.customerSpace.kind === "EXTERNAL_MANAGED") {
      await tx.customerSpace.delete({
        where: { id: existing.customerSpaceId },
      });
    }
    // 派生的 PDF 预览件与源文件一起清理
    return attachments.flatMap((attachment) =>
      [attachment.storageKey, attachment.previewStorageKey].filter(
        (value): value is string => Boolean(value),
      ),
    );
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
