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
    /** iframe 模式专用；launchMode 为 native 时不能传 */
    returnOrigin?: string;
    /** 默认 iframe；桌面 / 移动 App 顶层打开用 native（连接需开启 Native Launch） */
    launchMode?: "iframe" | "native";
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
        Authorization: basicAuthorization(input.clientId, input.clientSecret),
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

function basicAuthorization(clientId: string, clientSecret: string) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

/**
 * Native Launch：为已登录的 App 用户创建票据。返回的 launchUrl 需要原样交给 App 的
 * 独立窗口 / 系统浏览器 / WebView 顶层打开（不要放进 iframe，也不要去掉片段里的 mode=native）。
 */
export function createNativeLaunchTicket(input: {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  user: AchordConnectUser;
  context?: { theme?: "light" | "dark" | "system"; locale?: string };
}) {
  return createLaunchTicket({
    ...input,
    context: { ...input.context, launchMode: "native" },
  });
}

export type AchordConnectContactUnread = {
  externalUserId: string;
  unreadCount: number;
  requests: Array<{
    id: string;
    number: string;
    title: string;
    status: string;
    unreadCount: number;
    updatedAt: string;
  }>;
};

/** 服务端查询某个外部用户的未读数（启动时或 Webhook 丢失后重建未读红点） */
export async function getContactUnread(input: {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  externalUserId: string;
}): Promise<AchordConnectContactUnread> {
  const response = await fetch(
    new URL(
      `/api/v1/integrations/universal/contacts/${encodeURIComponent(input.externalUserId)}/unread`,
      input.baseUrl,
    ),
    { headers: { Authorization: basicAuthorization(input.clientId, input.clientSecret) } },
  );
  const payload = (await response.json()) as {
    data?: AchordConnectContactUnread;
    error?: { message?: string };
  };
  if (!response.ok || !payload.data) {
    throw new Error(payload.error?.message ?? `Achord Connect HTTP ${response.status}`);
  }
  return payload.data;
}

/**
 * App 端（WebView 页面加载前注入）接收门户事件的桥接对象示例。
 * 门户以 JSON 字符串调用 postMessage：ready / unread-changed / session-expired / close-requested。
 */
export const nativeBridgeInitScript = `window.AchordConnectNative = {
  postMessage(message) {
    const event = JSON.parse(message);
    if (event.source !== "achord-connect-v1") return;
    // 交给宿主处理，例如 Tauri: window.__TAURI__.event.emit("achord-connect", event)
  },
};`;

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
