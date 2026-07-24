"use client";

export const REALTIME_EVENT_TYPES = [
  "PROJECT_UPDATED",
  "PROJECT_UPDATE_CREATED",
  "UPDATE_COMMENT_CREATED",
  "REQUEST_CREATED",
  "REQUEST_ASSIGNED",
  "REQUEST_MESSAGE_CREATED",
  "REQUEST_STATUS_CHANGED",
  "REQUEST_UPDATED",
  "REQUEST_PRESENCE_CHANGED",
  "REQUEST_TYPING_CHANGED",
  "PLUGIN_RUN_UPDATED",
  "CONTENT_RISK_REVIEW_UPDATED",
  "NOTIFICATION_CREATED",
] as const;

export type RealtimeEventType = (typeof REALTIME_EVENT_TYPES)[number];

export type RealtimeEventPayload = {
  eventId?: string;
  userId?: string | null;
  actorId?: string;
  projectId?: string | null;
  serviceRequestId?: string | null;
  requestId?: string;
  customerSpaceId?: string | null;
  visibility?: string;
  [key: string]: unknown;
};

export type RealtimeEvent = {
  type: RealtimeEventType;
  payload: RealtimeEventPayload;
  live: boolean;
  replayed: boolean;
  lastEventId: string;
};

type EventListener = (event: RealtimeEvent) => void;
type ReadyListener = (state: { reconnected: boolean }) => void;

const eventListeners = new Map<RealtimeEventType, Set<EventListener>>();
const readyListeners = new Set<ReadyListener>();
const recentEvents: RealtimeEvent[] = [];
const MAX_RECENT_EVENTS = 100;

let source: EventSource | null = null;
let liveReady = false;
let readyCount = 0;

function parsePayload(value: string): RealtimeEventPayload | null {
  try {
    const payload = JSON.parse(value) as unknown;
    return payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as RealtimeEventPayload)
      : null;
  } catch {
    return null;
  }
}

function rememberEvent(event: RealtimeEvent) {
  recentEvents.push(event);
  if (recentEvents.length > MAX_RECENT_EVENTS) {
    recentEvents.splice(0, recentEvents.length - MAX_RECENT_EVENTS);
  }
}

function emitEvent(type: RealtimeEventType, message: MessageEvent<string>) {
  const payload = parsePayload(message.data);
  if (!payload) return;
  const event: RealtimeEvent = {
    type,
    payload,
    live: liveReady,
    replayed: false,
    lastEventId: message.lastEventId,
  };
  rememberEvent(event);
  for (const listener of eventListeners.get(type) ?? []) {
    listener(event);
  }
}

function emitReady() {
  liveReady = true;
  readyCount += 1;
  const state = { reconnected: readyCount > 1 };
  for (const listener of readyListeners) {
    listener(state);
  }
}

function ensureSource() {
  if (source || typeof window === "undefined") return;
  source = new EventSource("/api/v1/notifications/stream");
  for (const type of REALTIME_EVENT_TYPES) {
    source.addEventListener(type, ((event: MessageEvent<string>) => {
      emitEvent(type, event);
    }) as EventListenerOrEventListenerObject);
  }
  source.addEventListener("STREAM_READY", emitReady);
  source.addEventListener("error", () => {
    liveReady = false;
  });
}

function activeListenerCount() {
  let count = readyListeners.size;
  for (const listeners of eventListeners.values()) {
    count += listeners.size;
  }
  return count;
}

function closeIfUnused() {
  if (activeListenerCount() > 0) return;
  source?.close();
  source = null;
  liveReady = false;
  readyCount = 0;
  recentEvents.length = 0;
}

export function subscribeRealtime(
  types: readonly RealtimeEventType[],
  listener: EventListener,
) {
  for (const type of types) {
    const listeners = eventListeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    eventListeners.set(type, listeners);
  }
  ensureSource();

  for (const event of recentEvents) {
    if (types.includes(event.type)) {
      listener({ ...event, live: false, replayed: true });
    }
  }

  return () => {
    for (const type of types) {
      const listeners = eventListeners.get(type);
      listeners?.delete(listener);
      if (listeners?.size === 0) eventListeners.delete(type);
    }
    closeIfUnused();
  };
}

export function subscribeRealtimeReady(listener: ReadyListener) {
  readyListeners.add(listener);
  ensureSource();
  if (liveReady) {
    queueMicrotask(() => {
      if (readyListeners.has(listener)) {
        listener({ reconnected: readyCount > 1 });
      }
    });
  }
  return () => {
    readyListeners.delete(listener);
    closeIfUnused();
  };
}

export function matchesRealtimeScope(
  payload: RealtimeEventPayload,
  scope: { projectId?: string; requestId?: string },
) {
  if (payload.scope === "GLOBAL") return true;
  if (scope.requestId) {
    return (
      payload.requestId === scope.requestId ||
      payload.serviceRequestId === scope.requestId
    );
  }
  if (scope.projectId) {
    return payload.projectId === scope.projectId;
  }
  return true;
}

export function isProjectDeletedRealtimeEvent(
  event: RealtimeEvent,
  projectId?: string,
) {
  return (
    event.type === "PROJECT_UPDATED" &&
    event.payload.change === "PROJECT_DELETED" &&
    (!projectId || event.payload.projectId === projectId)
  );
}

export function resetRealtimeClientForTests() {
  source?.close();
  source = null;
  liveReady = false;
  readyCount = 0;
  recentEvents.length = 0;
  eventListeners.clear();
  readyListeners.clear();
}
