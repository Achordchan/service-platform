import { acquireAbortableResource } from "@/lib/abortable-resource";
import { withExternalActorDb } from "@/lib/external-actor";
import {
  type DatabaseNotification,
  subscribeDatabaseNotifications,
} from "@/lib/postgres-event-listener";
import {
  isExternalSessionActive,
  requireExternalSession,
} from "@/modules/integrations/external/session-service";
import { routeError } from "@/modules/projects/api-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function encodeEvent(event: {
  id: bigint;
  type: string;
  payload: unknown;
  projectId: string | null;
  serviceRequestId: string | null;
}) {
  const payload =
    event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
      ? event.payload as Record<string, unknown>
      : { value: event.payload };
  return encoder.encode(
    `id: ${event.id.toString()}\nevent: ${event.type}\ndata: ${JSON.stringify({
      ...payload,
      eventId: event.id.toString(),
      projectId: event.projectId ?? payload.projectId ?? null,
      serviceRequestId:
        event.serviceRequestId ?? payload.serviceRequestId ?? payload.requestId ?? null,
    })}\n\n`,
  );
}

function parseExternalTransient(
  value: string | null,
  externalContactId: string,
) {
  if (!value) return null;
  try {
    const envelope = JSON.parse(value) as {
      type?: unknown;
      externalContactIds?: unknown;
      payload?: unknown;
    };
    if (
      envelope.type !== "REQUEST_TYPING_CHANGED" ||
      !Array.isArray(envelope.externalContactIds) ||
      !envelope.externalContactIds.includes(externalContactId) ||
      !envelope.payload ||
      typeof envelope.payload !== "object" ||
      Array.isArray(envelope.payload)
    ) {
      return null;
    }
    return envelope.payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  try {
    const session = await requireExternalSession(request);
    const headerId = request.headers.get("last-event-id");
    let cursor: bigint | null =
      headerId && /^\d+$/.test(headerId) ? BigInt(headerId) : null;
    let closed = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    let unsubscribe: (() => void) | undefined;
    let handleNotification: (message: DatabaseNotification) => void = () =>
      undefined;
    const close = (closeController: boolean) => {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
      if (closeController && controller) {
        try {
          controller.close();
        } catch {
          // The client may have aborted while the database listener closed.
        }
      }
    };

    const stream = new ReadableStream<Uint8Array>({
      async start(streamController) {
        controller = streamController;
        const sendPending = async () => {
          while (!closed) {
            // First connection without a resume cursor: jump to the current head so
            // we do not replay the contact's entire history.
            if (cursor === null) {
              const latest = await withExternalActorDb(session.actor, (tx) =>
                tx.eventRecord.findFirst({
                  where: { serviceRequestId: { not: null } },
                  orderBy: { id: "desc" },
                  select: { id: true },
                }),
              );
              cursor = latest?.id ?? 0n;
              break;
            }
            const afterId = cursor;
            const events = await withExternalActorDb(session.actor, (tx) =>
              tx.eventRecord.findMany({
                where: {
                  id: { gt: afterId },
                  serviceRequestId: { not: null },
                },
                orderBy: { id: "asc" },
                take: 100,
              }),
            );
            for (const event of events) {
              if (closed) return;
              streamController.enqueue(encodeEvent(event));
              cursor = event.id;
            }
            if (events.length < 100) break;
          }
        };
        let pending = Promise.resolve();
        const queuePending = () => {
          pending = pending.then(sendPending);
          return pending;
        };
        let checkingSession = false;
        heartbeat = setInterval(() => {
          if (closed || checkingSession) return;
          checkingSession = true;
          void isExternalSessionActive(session.sessionId)
            .then((active) => {
              if (!active) return close(true);
              if (!closed) {
                streamController.enqueue(encoder.encode(": heartbeat\n\n"));
              }
            })
            .catch(() => close(true))
            .finally(() => {
              checkingSession = false;
            });
        }, 25_000);
        handleNotification = (message) => {
          if (message.channel === "service_platform_events") {
            void queuePending().catch(() => close(true));
            return;
          }
          if (message.channel !== "service_platform_transient_events") return;
          const payload = parseExternalTransient(
            message.payload ?? null,
            session.actor.id,
          );
          if (!payload || closed) return;
          streamController.enqueue(
            encoder.encode(
              `event: REQUEST_TYPING_CHANGED\ndata: ${JSON.stringify(payload)}\n\n`,
            ),
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
          const readyCursor = cursor ?? 0n;
          streamController.enqueue(
            encoder.encode(
              `id: ${readyCursor.toString()}\nevent: STREAM_READY\ndata: ${JSON.stringify({ eventId: readyCursor.toString() })}\n\n`,
            ),
          );
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
  } catch (error) {
    return routeError(error);
  }
}
