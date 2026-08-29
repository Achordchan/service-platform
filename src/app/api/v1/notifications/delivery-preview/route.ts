import { NextResponse } from "next/server";
import { z } from "zod";
import { withActorDb } from "@/lib/actor";
import { assertAllowed } from "@/modules/projects/errors";
import { resolveDeliveryPreview } from "@/modules/notifications/delivery-preview-service";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";
import { previewMilestoneDelivery } from "@/modules/projects/milestone-service";
import { previewProjectUpdateDelivery } from "@/modules/projects/project-update-service";
import { previewProjectStaffDelivery } from "@/modules/projects/project-staff-service";
import { previewRequestDelivery } from "@/modules/requests/request-command-service";

const sceneSchema = z.discriminatedUnion("scene", [
  z.object({
    scene: z.literal("PROJECT_UPDATE"),
    projectId: z.string().min(1),
    visibility: z.enum(["CUSTOMER_VISIBLE", "INTERNAL"]),
  }),
  z.object({
    scene: z.literal("PROJECT_MILESTONE"),
    projectId: z.string().min(1),
  }),
  z.object({
    scene: z.literal("PROJECT_STAFF"),
    projectId: z.string().min(1),
    targetUserId: z.string().min(1),
  }),
  z.object({
    scene: z.literal("REQUEST_PUBLIC_MESSAGE"),
    requestId: z.string().min(1),
  }),
  z.object({
    scene: z.literal("REQUEST_STATUS"),
    requestId: z.string().min(1),
    status: z.enum([
      "PENDING",
      "IN_PROGRESS",
      "WAITING_CUSTOMER",
      "RESOLVED",
      "CLOSED",
    ]),
  }),
]);

/**
 * 发送前预览：这次操作会通知到谁、每人在站内/邮件/微信各是什么状态。
 *
 * 收件人计算复用真正发送时的那套函数（各领域 service 的 preview* 入口），
 * 这里只做场景分发。仅员工可用 —— 返回内容包含收件人的邮件退订状态。
 */
export async function POST(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    assertAllowed(auth.actor.isStaff);
    const input = sceneSchema.parse(await readJson(request));
    const recipients =
      input.scene === "PROJECT_UPDATE"
        ? await previewProjectUpdateDelivery(
            auth.actor,
            input.projectId,
            input.visibility,
          )
        : input.scene === "PROJECT_MILESTONE"
          ? await previewMilestoneDelivery(auth.actor, input.projectId)
          : input.scene === "PROJECT_STAFF"
            ? await previewProjectStaffDelivery(
                auth.actor,
                input.projectId,
                input.targetUserId,
              )
            : input.scene === "REQUEST_STATUS"
              ? await previewRequestDelivery(
                  auth.actor,
                  input.requestId,
                  "STATUS",
                  input.status,
                )
              : await previewRequestDelivery(
                  auth.actor,
                  input.requestId,
                  "PUBLIC_MESSAGE",
                );

    const preview = await withActorDb(auth.actor, (tx) =>
      resolveDeliveryPreview(tx, recipients),
    );
    return NextResponse.json({ data: preview });
  } catch (error) {
    return routeError(error);
  }
}
