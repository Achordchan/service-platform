import { acquireAbortableResource } from "@/lib/abortable-resource";
import {
  type DatabaseNotification,
  subscribeDatabaseNotifications,
} from "@/lib/postgres-event-listener";
import { requireUserWithAccess } from "@/lib/session";
import { listVisibleEvents } from "@/modules/notifications/notification-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function encodeEvent(event: {
  id: string;
  type: string;
  payload: unknown;
  userId?: string | null;
  projectId?: string | null;
  serviceRequestId?: string | null;
  customerSpaceId?: string | null;
}) {
  const payload =
    event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
      ? (event.payload as Record<string, unknown>)
      : { value: event.payload };

  const data = {
    ...payload,
    eventId: event.id,
    userId: event.userId ?? null,
    projectId: event.projectId ?? payload.projectId ?? null,
    serviceRequestId:
      event.serviceRequestId ?? payload.serviceRequestId ?? payload.requestId ?? null,
    customerSpaceId: event.customerSpaceId ?? null,
  };

  return encoder.encode(
    `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(data)}\n\n`,
  );
}

function encodeReady(cursor: bigint) {
  return encoder.encode(
    `id: ${cursor.toString()}\nevent: STREAM_READY\ndata: ${JSON.stringify({
      eventId: cursor.toString(),
    })}\n\n`,
  );
}

function encodeTransientEvent(type: string, payload: Record<string, unknown>) {
  return encoder.encode(
    `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`,
  );
}

function parseTransientEvent(value: string | null) {
  if (!value) return null;
  try {
    const envelope = JSON.parse(value) as {
      type?: unknown;
      userIds?: unknown;
      payload?: unknown;
    };
    if (
      envelope.type !== "REQUEST_TYPING_CHANGED" ||
      !Array.isArray(envelope.userIds) ||
      !envelope.userIds.every((item) => typeof item === "string") ||
      !envelope.payload ||
      typeof envelope.payload !== "object" ||
      Array.isArray(envelope.payload)
    ) {
      return null;
    }
    return {
      type: envelope.type,
      userIds: envelope.userIds,
      payload: envelope.payload as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const { actor } = await requireUserWithAccess();
  const headerId = request.headers.get("last-event-id") ?? "0";
  let cursor = /^\d+$/.test(headerId) ? BigInt(headerId) : 0n;
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;
  let handleNotification: (message: DatabaseNotification) => void = () =>
    undefined;
  let controller:
    | ReadableStreamDefaultController<Uint8Array>
    | undefined;

  const close = (closeController: boolean) => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    unsubscribe?.();
    if (!closeController || !controller) return;
    try {
      controller.close();
    } catch {
      // Stream may already be closed by cancel/abort races.
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(streamController) {
      controller = streamController;
      const sendPending = async () => {
        if (closed) return;
        while (!closed) {
          const events = await listVisibleEvents(actor, cursor);
          for (const event of events) {
            if (closed) return;
            streamController.enqueue(encodeEvent(event));
            cursor = BigInt(event.id);
          }
          if (events.length < 100) return;
        }
      };
      let pendingSend = Promise.resolve();
      const queuePending = () => {
        pendingSend = pendingSend.then(sendPending);
        return pendingSend;
      };

      heartbeat = setInterval(() => {
        if (!closed) {
          streamController.enqueue(encoder.encode(": heartbeat\n\n"));
        }
      }, 25_000);

      handleNotification = (message) => {
        if (message.channel === "service_platform_events") {
          void queuePending().catch(() => close(true));
          return;
        }
        if (message.channel !== "service_platform_transient_events") return;
        const transient = parseTransientEvent(message.payload ?? null);
        if (!transient || !transient.userIds.includes(actor.id) || closed) {
          return;
        }
        streamController.enqueue(
          encodeTransientEvent(transient.type, transient.payload),
        );
      };
      unsubscribe = await acquireAbortableResource({
        signal: request.signal,
        acquire: () =>
          subscribeDatabaseNotifications((message) =>
            handleNotification(message),
          ),
        onAbort: () => close(true),
      });
      if (closed) {
        unsubscribe();
        return;
      }

      await queuePending();
      if (!closed) {
        streamController.enqueue(encodeReady(cursor));
      }
    },
    cancel() {
      close(false);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
