import "server-only";

import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { dispatchProjectActivity } from "@/modules/notifications/notification-service";
import { assertCanManageActiveProjectDelivery } from "@/modules/projects/project-access";
import { assertFound } from "@/modules/projects/errors";
import type { UpdateProjectStageInput } from "@/modules/projects/schemas";

export function updateProjectStage(
  actor: Actor,
  projectId: string,
  input: UpdateProjectStageInput,
) {
  return withActorDb(actor, async (tx) => {
    const context = await assertCanManageActiveProjectDelivery(
      tx,
      actor,
      projectId,
    );
    const existing = await tx.project.findUnique({
      where: { id: projectId },
      select: { id: true, currentStage: true },
    });
    assertFound(existing, "项目不存在");

    const project = await tx.project.update({
      where: { id: projectId },
      data: { currentStage: input.currentStage ?? null },
      select: { id: true, currentStage: true, updatedAt: true },
    });

    await writeAuditLog(tx, actor, {
      action: "PROJECT_STAGE_UPDATED",
      resourceType: "Project",
      resourceId: projectId,
      customerSpaceId: context.customerSpaceId,
      projectId,
      metadata: {
        previousStage: existing.currentStage,
        currentStage: project.currentStage,
      },
    });
    await dispatchProjectActivity(tx, actor, {
      eventType: "PROJECT_UPDATED",
      eventPayload: {
        change: "PROJECT_STAGE_UPDATED",
        actorId: actor.id,
        projectId,
        currentStage: project.currentStage,
      },
      notificationType: "PROJECT_STAGE",
      notificationTitle: "项目阶段已更新",
      notificationBody: project.currentStage || "项目阶段已清空",
      visibility: context.customerFeatures.progress
        ? "CUSTOMER_VISIBLE"
        : "INTERNAL",
      customerSpaceId: context.customerSpaceId,
      projectId,
    });

    return project;
  });
}
