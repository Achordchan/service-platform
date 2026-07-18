import pg from "pg";
import { env } from "@/lib/runtime-env";

export type DatabaseNotification = {
  channel: string;
  payload: string | null;
};

type NotificationListener = (message: DatabaseNotification) => void;

type ListenerState = {
  client?: pg.Client;
  connectPromise?: Promise<void>;
  listeners?: Set<NotificationListener>;
  reconnectTimer?: ReturnType<typeof setTimeout>;
};

const globalForDatabaseEvents = globalThis as unknown as {
  servicePlatformDatabaseEvents?: ListenerState;
};

const state = (globalForDatabaseEvents.servicePlatformDatabaseEvents ??= {});
state.listeners ??= new Set();

const RECONNECT_DELAY_MS = 5_000;
const CHANNELS = [
  "service_platform_events",
  "service_platform_transient_events",
] as const;

function broadcast(message: DatabaseNotification) {
  for (const listener of state.listeners ?? []) {
    try {
      listener(message);
    } catch {
      // One broken stream must not interrupt delivery to other subscribers.
    }
  }
}

function scheduleReconnect() {
  if (state.reconnectTimer || !state.listeners?.size) return;
  const timer = setTimeout(() => {
    state.reconnectTimer = undefined;
    void ensureConnected().catch(() => scheduleReconnect());
  }, RECONNECT_DELAY_MS);
  timer.unref();
  state.reconnectTimer = timer;
}

function handleDisconnect(client: pg.Client) {
  if (state.client !== client) return;
  state.client = undefined;
  client.removeAllListeners();
  void client.end().catch(() => undefined);
  scheduleReconnect();
}

async function ensureConnected() {
  if (state.client) return;
  if (state.connectPromise) return state.connectPromise;

  const connectPromise = (async () => {
    const client = new pg.Client({ connectionString: env.DATABASE_URL });
    try {
      await client.connect();
      for (const channel of CHANNELS) {
        await client.query(`LISTEN ${channel}`);
      }
      state.client = client;
      client.on("notification", (message) => {
        broadcast({
          channel: message.channel,
          payload: message.payload ?? null,
        });
      });
      client.on("error", () => handleDisconnect(client));
      client.on("end", () => handleDisconnect(client));

      // Durable events created while reconnecting are recovered from EventRecord.
      broadcast({ channel: "service_platform_events", payload: null });
    } catch (error) {
      client.removeAllListeners();
      await client.end().catch(() => undefined);
      throw error;
    }
  })();

  state.connectPromise = connectPromise;
  try {
    await connectPromise;
  } finally {
    if (state.connectPromise === connectPromise) {
      state.connectPromise = undefined;
    }
  }
}

export async function subscribeDatabaseNotifications(
  listener: NotificationListener,
) {
  state.listeners?.add(listener);
  try {
    await ensureConnected();
  } catch (error) {
    state.listeners?.delete(listener);
    throw error;
  }
  return () => {
    state.listeners?.delete(listener);
  };
}
