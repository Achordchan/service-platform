import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";

export async function findRequestContext(
  tx: Prisma.TransactionClient,
  requestId: string,
  actorId: string,
) {
  const request = await tx.serviceRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      archivedAt: true,
      assigneeId: true,
      projectId: true,
      createdById: true,
      createdByExternalContactId: true,
    },
  });
  if (!request) return null;

  const contact = request.createdByExternalContactId
    ? await tx.externalContact.findUnique({
        where: { id: request.createdByExternalContactId },
        select: {
          id: true,
          bindingId: true,
          displayName: true,
          email: true,
          status: true,
          lastParentOrigin: true,
        },
      })
    : null;
  let createdByExternalContact = null;
  if (contact) {
    const binding = await tx.projectPluginBinding.findUniqueOrThrow({
      where: { id: contact.bindingId },
      select: { id: true, status: true, pluginKey: true },
    });
    const plugin = await tx.pluginInstallation.findUniqueOrThrow({
      where: { key: binding.pluginKey },
      select: { enabled: true, healthStatus: true },
    });
    const sub2ApiConnection = await tx.sub2ApiConnection.findUnique({
      where: { bindingId: binding.id },
      select: {
        baseUrl: true,
        emailNotificationsEnabled: true,
        customerMemberNotificationsEnabled: true,
      },
    });
    const universalConnection = await tx.universalConnectorConnection.findUnique({
      where: { bindingId: binding.id },
      select: {
        allowedOrigins: true,
        emailNotificationsEnabled: true,
        customerMemberNotificationsEnabled: true,
      },
    });
    createdByExternalContact = {
      id: contact.id,
      displayName: contact.displayName,
      email: contact.email,
      status: contact.status,
      lastParentOrigin: contact.lastParentOrigin,
      binding: {
        status: binding.status,
        pluginKey: binding.pluginKey,
        plugin,
        sub2ApiConnection,
        universalConnection,
      },
    };
  }
  const assignees = await tx.requestAssignee.findMany({
    where: { serviceRequestId: request.id },
    select: { userId: true },
  });
  const project = await tx.project.findUniqueOrThrow({
    where: { id: request.projectId },
    select: {
      customerSpaceId: true,
      title: true,
      customerRequestsEnabled: true,
    },
  });
  const staff = await tx.projectStaff.findMany({
    where: { projectId: request.projectId, userId: actorId },
    select: { role: true },
    take: 1,
  });
  return {
    ...request,
    createdByExternalContact,
    assignees,
    project: { ...project, staff },
  };
}

export function canAccessCustomerRequestModule(
  actor: Actor,
  request: { project: { customerRequestsEnabled: boolean } },
) {
  return actor.isStaff || request.project.customerRequestsEnabled;
}

export function getProjectRole(
  request: NonNullable<Awaited<ReturnType<typeof findRequestContext>>>,
) {
  return request.project.staff[0]?.role ?? null;
}
