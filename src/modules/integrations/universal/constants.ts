export const UNIVERSAL_PLUGIN_KEY = "universal-embed-connector";
export const UNIVERSAL_PROTOCOL_NAME = "Achord Connect v1";
export const UNIVERSAL_TICKET_TTL_MS = 60_000;
export const UNIVERSAL_SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000;
export const UNIVERSAL_CONNECTION_RATE_LIMIT = 300;
export const UNIVERSAL_USER_RATE_LIMIT = 20;
export const UNIVERSAL_RATE_WINDOW_MS = 60_000;
export const UNIVERSAL_MAX_ACTIVE_CREDENTIALS = 2;
export const UNIVERSAL_MAX_PROFILE_FIELDS = 10;
export const UNIVERSAL_WEBHOOK_EVENTS = [
  "request.created",
  "request.public_message.created",
  "request.status.changed",
  "request.unread.changed",
] as const;
export type UniversalWebhookEventType =
  (typeof UNIVERSAL_WEBHOOK_EVENTS)[number];
export const UNIVERSAL_WEBHOOK_MAX_ATTEMPTS = 6;
export const UNIVERSAL_WEBHOOK_RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  12 * 60 * 60_000,
] as const;
export const UNIVERSAL_WEBHOOK_TIMEOUT_MS = 5_000;
export const UNIVERSAL_WEBHOOK_RESPONSE_MAX_BYTES = 64 * 1024;
export const UNIVERSAL_WEBHOOK_PROCESSING_STALE_MS = 10 * 60_000;
