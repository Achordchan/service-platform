import type { Prisma } from "@/generated/prisma/client";

export async function findRequestContext(
  tx: Prisma.TransactionClient,
  requestId: string,
  actorId: string,
) {
  return tx.serviceRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      assigneeId: true,
      projectId: true,
      createdById: true,
      createdByExternalContactId: true,
      createdByExternalContact: {
        select: {
          id: true,
          displayName: true,
          email: true,
          status: true,
          binding: {
            select: {
              status: true,
              plugin: {
                select: {
                  enabled: true,
                  healthStatus: true,
                },
              },
              sub2ApiConnection: {
                select: {
                  baseUrl: true,
                  emailNotificationsEnabled: true,
                  customerMemberNotificationsEnabled: true,
                },
              },
            },
          },
        },
      },
      assignees: {
        select: { userId: true },
      },
      project: {
        select: {
          customerSpaceId: true,
          title: true,
          staff: {
            where: { userId: actorId },
            select: { role: true },
            take: 1,
          },
        },
      },
    },
  });
}

export function getProjectRole(
  request: NonNullable<Awaited<ReturnType<typeof findRequestContext>>>,
) {
  return request.project.staff[0]?.role ?? null;
}
