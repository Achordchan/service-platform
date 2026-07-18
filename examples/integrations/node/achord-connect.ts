import { createHmac, timingSafeEqual } from "node:crypto";

export type AchordConnectUser = {
  id: string;
  name: string;
  email?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
  attributes?: Record<string, string | number | boolean>;
};

export async function createLaunchTicket(input: {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  user: AchordConnectUser;
  context?: {
    theme?: "light" | "dark" | "system";
    locale?: string;
    returnOrigin?: string;
  };
}) {
  if (typeof input.user.id !== "string" || input.user.id.trim() === "") {
    throw new TypeError("Achord Connect user.id must be a non-empty string");
  }
  const response = await fetch(
    new URL("/api/v1/integrations/universal/launch-tickets", input.baseUrl),
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user: input.user, context: input.context ?? {} }),
    },
  );
  const payload = (await response.json()) as {
    data?: { launchUrl: string; expiresAt: string };
    error?: { message?: string };
  };
  if (!response.ok || !payload.data) {
    throw new Error(payload.error?.message ?? `Achord Connect HTTP ${response.status}`);
  }
  return payload.data;
}

export function iframeHtml(launchUrl: string, title = "服务请求") {
  const parsed = new URL(launchUrl);
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new TypeError("Achord Connect launchUrl must use HTTP or HTTPS");
  }
  const escapeAttribute = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const escapedUrl = escapeAttribute(parsed.toString());
  const escapedTitle = escapeAttribute(title);
  return `<iframe src="${escapedUrl}" title="${escapedTitle}" style="width:100%;min-height:720px;border:0" allow="clipboard-write"></iframe>`;
}

export function verifyWebhook(input: {
  secret: string;
  rawBody: string;
  eventId: string | null;
  timestamp: string | null;
  signature: string | null;
  toleranceSeconds?: number;
  nowSeconds?: number;
}) {
  if (!input.eventId || !input.timestamp || !input.signature?.startsWith("v1=")) {
    return false;
  }
  const timestamp = Number(input.timestamp);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (
    !Number.isFinite(timestamp) ||
    Math.abs(now - timestamp) > (input.toleranceSeconds ?? 300)
  ) {
    return false;
  }
  const expected = createHmac("sha256", input.secret)
    .update(`${input.timestamp}.${input.rawBody}`)
    .digest("hex");
  const actual = input.signature.slice(3);
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actual, "hex");
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}
