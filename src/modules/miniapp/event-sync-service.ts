import "server-only";

import type { Actor } from "@/lib/actor";
import { listVisibleEventBatch } from "@/modules/notifications/notification-service";

export type MiniappEvent = {
  id: string;
  type: string;
  payload: unknown;
  projectId: string | null;
  serviceRequestId: string | null;
  customerSpaceId: string | null;
  createdAt: string;
};

export type MiniappEventBatch = {
  events: MiniappEvent[];
  cursor: string;
  hasMore: boolean;
};

const MAX_EVENT_LIMIT = 200;

// 小程序端无 EventSource：以 EventRecord 自增游标做增量拉取。
// 可见性完全复用 Web SSE 的 listVisibleEventBatch（RLS + 项目开关 + INTERNAL 剔除）。
export async function listMiniappEvents(
  actor: Actor,
  afterCursor: bigint,
  limit = 100,
): Promise<MiniappEventBatch> {
  const batchLimit = Math.min(Math.max(limit, 1), MAX_EVENT_LIMIT);
  const batch = await listVisibleEventBatch(actor, afterCursor, batchLimit);
  return {
    events: batch.events.map((event) => ({
      id: event.id,
      type: event.type as string,
      payload: event.payload,
      projectId: event.projectId ?? null,
      serviceRequestId: event.serviceRequestId ?? null,
      customerSpaceId: event.customerSpaceId ?? null,
      createdAt: event.createdAt.toISOString(),
    })),
    cursor: batch.nextCursor.toString(),
    hasMore: batch.scannedCount >= batchLimit,
  };
}
