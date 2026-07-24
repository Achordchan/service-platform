import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import {
  isContentRiskStateRevoked,
  loadContentRiskPageState,
} from "@/modules/plugins/content-risk-view-service";
import { calculateProjectProgress } from "@/modules/projects/progress";

export const projectBaseSelect = {
  id: true,
  title: true,
  description: true,
  status: true,
  kind: true,
  currentStage: true,
  showMilestones: true,
  showProgress: true,
  customerUpdatesEnabled: true,
  customerRequestsEnabled: true,
  customerFilesEnabled: true,
  startDate: true,
  endDate: true,
  customerSpaceId: true,
  serviceTypeId: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type ProjectBase = Prisma.ProjectGetPayload<{
  select: typeof projectBaseSelect;
}>;

export async function hydrateProjectSummaries(
  tx: Prisma.TransactionClient,
  projects: ProjectBase[],
  actor: Actor,
) {
  if (projects.length === 0) return [];
  const projectIds = projects.map((project) => project.id);
  const customerSpaces = await tx.customerSpace.findMany({
    where: { id: { in: projects.map((project) => project.customerSpaceId) } },
    select: { id: true, name: true, slug: true, status: true },
  });
  const serviceTypes = await tx.serviceType.findMany({
    where: { id: { in: projects.map((project) => project.serviceTypeId) } },
    select: { id: true, key: true, name: true },
  });
  const requestCategories = await tx.requestCategory.findMany({
    where: {
      serviceTypeId: { in: projects.map((project) => project.serviceTypeId) },
      active: true,
    },
    select: { id: true, serviceTypeId: true, name: true },
    orderBy: { name: "asc" },
  });
  const managerRows = await tx.projectStaff.findMany({
    where: { projectId: { in: projectIds }, role: "PROJECT_MANAGER" },
    select: { projectId: true, userId: true, role: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const managerUsers = await tx.user.findMany({
    where: { id: { in: managerRows.map((row) => row.userId) } },
    select: { id: true, name: true },
  });
  const progressProjectIds = projects
    .filter((project) => actor.isStaff || project.showProgress)
    .map((project) => project.id);
  const milestones =
    progressProjectIds.length > 0
      ? await tx.milestone.findMany({
          where: { projectId: { in: progressProjectIds } },
          select: { id: true, projectId: true, status: true },
        })
      : [];
  const contentRisk = await loadContentRiskPageState(
    milestones.map((milestone) => ({
      targetType: "MILESTONE" as const,
      targetId: milestone.id,
    })),
    tx,
  );
  const pluginBindings = await tx.projectPluginBinding.findMany({
    where: { projectId: { in: projectIds } },
    select: { projectId: true, pluginKey: true, status: true },
  });
  const staffCounts = await tx.projectStaff.groupBy({
    by: ["projectId"],
    where: { projectId: { in: projectIds } },
    _count: { _all: true },
  });
  const updateCounts = await tx.projectUpdate.groupBy({
    by: ["projectId"],
    where: { projectId: { in: projectIds } },
    _count: { _all: true },
  });
  const requestCounts = await tx.serviceRequest.groupBy({
    by: ["projectId"],
    where: { projectId: { in: projectIds } },
    _count: { _all: true },
  });

  const customerSpaceById = new Map(
    customerSpaces.map((space) => [space.id, space]),
  );
  const categoriesByServiceTypeId = new Map<
    string,
    Array<{ id: string; name: string }>
  >();
  for (const category of requestCategories) {
    const current = categoriesByServiceTypeId.get(category.serviceTypeId) ?? [];
    current.push({ id: category.id, name: category.name });
    categoriesByServiceTypeId.set(category.serviceTypeId, current);
  }
  const serviceTypeById = new Map(
    serviceTypes.map((serviceType) => [
      serviceType.id,
      {
        ...serviceType,
        requestCategories:
          categoriesByServiceTypeId.get(serviceType.id) ?? [],
      },
    ]),
  );
  const managerById = new Map(managerUsers.map((user) => [user.id, user]));
  const managersByProjectId = new Map<
    string,
    Array<{ role: "PROJECT_MANAGER"; user: { id: string; name: string } }>
  >();
  for (const row of managerRows) {
    const user = managerById.get(row.userId);
    if (!user) continue;
    const current = managersByProjectId.get(row.projectId) ?? [];
    current.push({ role: "PROJECT_MANAGER", user });
    managersByProjectId.set(row.projectId, current);
  }
  const milestonesByProjectId = new Map<
    string,
    Array<{ status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" }>
  >();
  for (const milestone of milestones) {
    if (
      isContentRiskStateRevoked(
        contentRisk.states.get(`MILESTONE:${milestone.id}`),
      )
    ) {
      continue;
    }
    const current = milestonesByProjectId.get(milestone.projectId) ?? [];
    current.push({ status: milestone.status });
    milestonesByProjectId.set(milestone.projectId, current);
  }
  const bindingsByProjectId = new Map<
    string,
    Array<{ pluginKey: string; status: (typeof pluginBindings)[number]["status"] }>
  >();
  for (const binding of pluginBindings) {
    const current = bindingsByProjectId.get(binding.projectId) ?? [];
    current.push({ pluginKey: binding.pluginKey, status: binding.status });
    bindingsByProjectId.set(binding.projectId, current);
  }
  const staffCountByProjectId = new Map(
    staffCounts.map((row) => [row.projectId, row._count._all]),
  );
  const updateCountByProjectId = new Map(
    updateCounts.map((row) => [row.projectId, row._count._all]),
  );
  const requestCountByProjectId = new Map(
    requestCounts.map((row) => [row.projectId, row._count._all]),
  );

  return projects.map((project) => {
    const projectMilestones = milestonesByProjectId.get(project.id) ?? [];
    const progress = calculateProjectProgress(projectMilestones);
    return {
      ...project,
      customerSpace: customerSpaceById.get(project.customerSpaceId)!,
      serviceType: serviceTypeById.get(project.serviceTypeId)!,
      staff: managersByProjectId.get(project.id) ?? [],
      pluginBindings: bindingsByProjectId.get(project.id) ?? [],
      _count: {
        staff: staffCountByProjectId.get(project.id) ?? 0,
        updates: updateCountByProjectId.get(project.id) ?? 0,
        requests: requestCountByProjectId.get(project.id) ?? 0,
      },
      progress: progress.percentage,
      progressDetails: progress.counts,
    };
  });
}
