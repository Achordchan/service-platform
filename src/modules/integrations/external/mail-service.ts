import "server-only";

import type { RequestStatus } from "@/generated/prisma/client";
import { enqueueMail } from "@/lib/jobs";
import { withSystemDb } from "@/lib/system-db";
import { resolveUniversalActionUrl } from "@/modules/integrations/external/action-url";
import type { MailTemplateKey } from "@/modules/platform-settings/mail-template-catalog";

const statusTemplates: Partial<Record<RequestStatus, MailTemplateKey>> = {
  WAITING_CUSTOMER: "EXTERNAL_REQUEST_WAITING_CUSTOMER",
  RESOLVED: "EXTERNAL_REQUEST_RESOLVED",
  CLOSED: "EXTERNAL_REQUEST_CLOSED",
};

export async function enqueueExternalRequestStatusMail(
  serviceRequestId: string,
  status: RequestStatus,
) {
  const templateKey = statusTemplates[status];
  if (!templateKey) return;
  const mail = await withSystemDb(async (tx) => {
    const request = await tx.serviceRequest.findUnique({
      where: { id: serviceRequestId },
      select: {
        number: true,
        title: true,
        project: { select: { title: true } },
        createdByExternalContact: {
          select: {
            email: true,
            displayName: true,
            status: true,
            lastParentOrigin: true,
            binding: {
              select: {
                status: true,
                plugin: { select: { enabled: true, healthStatus: true } },
                sub2ApiConnection: {
                  select: { baseUrl: true, emailNotificationsEnabled: true },
                },
                universalConnection: {
                  select: {
                    allowedOrigins: true,
                    emailNotificationsEnabled: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    const contact = request?.createdByExternalContact;
    const binding = contact?.binding;
    if (
      !request ||
      !contact?.email ||
      contact.status !== "ACTIVE" ||
      binding?.status !== "ACTIVE" ||
      !binding.plugin.enabled ||
      binding.plugin.healthStatus !== "READY"
    ) {
      return null;
    }
    const actionUrl = binding.sub2ApiConnection?.emailNotificationsEnabled
      ? binding.sub2ApiConnection.baseUrl
      : binding.universalConnection?.emailNotificationsEnabled
        ? resolveUniversalActionUrl(
            contact.lastParentOrigin,
            binding.universalConnection.allowedOrigins,
          )
        : null;
    if (!actionUrl) return null;
    return {
      to: contact.email,
      templateKey,
      actionUrl,
      variables: {
        recipientName: contact.displayName,
        requestNumber: request.number,
        requestTitle: request.title,
        projectName: request.project.title,
      },
    };
  });
  if (!mail) return;
  try {
    await enqueueMail(mail);
  } catch (error) {
    console.error("EXTERNAL_REQUEST_MAIL_QUEUE_FAILED", {
      serviceRequestId,
      templateKey,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}
