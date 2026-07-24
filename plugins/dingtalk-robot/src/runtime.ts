import {
  DINGTALK_ROBOT_KEYWORD,
  parseDingTalkRobotBinding,
  DINGTALK_ROBOT_DEFAULT_CONFIG,
  type DingTalkRobotBinding,
  type DingTalkRobotTemplate,
} from "./config";

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 16 * 1024;

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type DingTalkTicketEventType =
  | "REQUEST_CREATED"
  | "REQUEST_CUSTOMER_REPLIED"
  | "CONTENT_RISK_ALERT";

export type DingTalkTicketEvent = {
  type: DingTalkTicketEventType;
  requestId?: string;
  requestNumber?: string;
  title?: string;
  requestUrl: string;
  customerName?: string | null;
  projectName?: string | null;
  priorityLabel?: string | null;
  actorName?: string | null;
  contentSummary?: string | null;
  targetLabel?: string | null;
  riskSummary?: string | null;
  occurredAt: Date | string;
};

export type DingTalkSendOptions = {
  fetch?: FetchLike;
  timeoutMs?: number;
  template?: DingTalkRobotTemplate;
};

export type DingTalkSendResult = {
  delivered: true;
  requestId?: string;
};

type DingTalkResponseBody = {
  errcode?: unknown;
  errmsg?: unknown;
  request_id?: unknown;
};

export class DingTalkRobotDeliveryError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "TIMEOUT"
      | "NETWORK_ERROR"
      | "HTTP_ERROR"
      | "INVALID_RESPONSE"
      | "DINGTALK_REJECTED",
  ) {
    super(message);
    this.name = "DingTalkRobotDeliveryError";
  }
}

export async function sendDingTalkTicketNotification(
  bindingInput: DingTalkRobotBinding | unknown,
  event: DingTalkTicketEvent,
  options: DingTalkSendOptions = {},
): Promise<DingTalkSendResult> {
  const binding = parseDingTalkRobotBinding(bindingInput);
  const payload = buildTicketPayload(event, options.template);
  return postDingTalkMessage(binding.webhookUrl, payload, options);
}

export async function testDingTalkRobotBinding(
  bindingInput: DingTalkRobotBinding | unknown,
  options: DingTalkSendOptions = {},
): Promise<DingTalkSendResult> {
  const binding = parseDingTalkRobotBinding(bindingInput);
  return postDingTalkMessage(
    binding.webhookUrl,
    {
      msgtype: "markdown",
      markdown: {
        title: `${DINGTALK_ROBOT_KEYWORD}：绑定成功`,
        text: [
          `## ${DINGTALK_ROBOT_KEYWORD}：绑定成功`,
          "",
          "服务支持中心已连接到当前钉钉群。后续新服务请求和客户回复会发送到这里。",
        ].join("\n"),
      },
      at: { isAtAll: false },
    },
    options,
  );
}

export function getDingTalkRobotRuntimeHealth() {
  return {
    runtime: "ready",
    transport: "DingTalk custom robot webhook",
    keyword: DINGTALK_ROBOT_KEYWORD,
  };
}

function buildTicketPayload(
  event: DingTalkTicketEvent,
  templateOverride?: DingTalkRobotTemplate,
) {
  const template =
    templateOverride ?? DINGTALK_ROBOT_DEFAULT_CONFIG.templates[event.type];
  const requestUrl = validateRequestUrl(event.requestUrl);
  const variables = {
    requestNumber: normalizeText(event.requestNumber),
    requestTitle: normalizeText(event.title),
    customerName: normalizeText(event.customerName),
    projectName: normalizeText(event.projectName),
    priorityLabel: normalizeText(event.priorityLabel),
    actorName: normalizeText(event.actorName),
    contentSummary: normalizeText(event.contentSummary),
    targetLabel: normalizeText(event.targetLabel),
    riskSummary: normalizeText(event.riskSummary),
    occurredAt: normalizeText(formatOccurredAt(event.occurredAt)),
  };
  const heading = renderTemplate(template.title, variables)
    .replace(/[\r\n]+/g, " ")
    .trim();
  const body = renderTemplate(template.body, variables)
    .split("\n")
    .filter((line) => !/[：:]\s*$/.test(line.trim()))
    .join("\n")
    .trim();

  return {
    msgtype: "markdown",
    markdown: {
      title: `${DINGTALK_ROBOT_KEYWORD}：${heading}`,
      text: [
        `## ${DINGTALK_ROBOT_KEYWORD}：${heading}`,
        "",
        body,
        "",
        `[${event.type === "CONTENT_RISK_ALERT" ? "打开风控插件" : "打开服务请求"}](${requestUrl})`,
      ].join("\n"),
    },
    at: { isAtAll: false },
  };
}

function renderTemplate(
  value: string,
  variables: Record<string, string>,
) {
  return value.replace(
    /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g,
    (match, key: string) => variables[key] ?? match,
  );
}

function normalizeText(value?: string | null) {
  if (!value) return "";
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/([\\`*_[\]()#+.!>|-])/g, "\\$1")
    .trim()
    .slice(0, 300);
}

function formatOccurredAt(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function validateRequestUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("服务请求链接格式无效");
  }
  const localHttp =
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (url.protocol !== "https:" && !localHttp) {
    throw new TypeError("服务请求链接协议无效");
  }
  if (url.username || url.password) {
    throw new TypeError("服务请求链接不能包含用户凭据");
  }
  return url.toString();
}

async function postDingTalkMessage(
  webhookUrl: string,
  payload: Record<string, unknown>,
  options: DingTalkSendOptions,
): Promise<DingTalkSendResult> {
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
      redirect: "error",
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timeout);
    if (controller.signal.aborted) {
      throw new DingTalkRobotDeliveryError(
        "钉钉机器人请求超时",
        "TIMEOUT",
      );
    }
    throw new DingTalkRobotDeliveryError(
      "钉钉机器人网络请求失败",
      "NETWORK_ERROR",
    );
  }

  try {
    if (!response.ok) {
      await discardResponse(response);
      throw new DingTalkRobotDeliveryError(
        `钉钉机器人请求失败（HTTP ${response.status}）`,
        "HTTP_ERROR",
      );
    }

    const responseText = await readLimitedResponse(response);
    let body: DingTalkResponseBody;
    try {
      body = JSON.parse(responseText) as DingTalkResponseBody;
    } catch {
      throw new DingTalkRobotDeliveryError(
        "钉钉机器人返回了无法识别的响应",
        "INVALID_RESPONSE",
      );
    }

    if (body.errcode !== 0) {
      const detail = safeRemoteMessage(body.errmsg);
      throw new DingTalkRobotDeliveryError(
        detail ? `钉钉机器人拒绝发送：${detail}` : "钉钉机器人拒绝发送",
        "DINGTALK_REJECTED",
      );
    }

    return {
      delivered: true,
      ...(typeof body.request_id === "string" && body.request_id
        ? { requestId: body.request_id }
        : {}),
    };
  } catch (error) {
    if (error instanceof DingTalkRobotDeliveryError) throw error;
    if (controller.signal.aborted) {
      throw new DingTalkRobotDeliveryError(
        "钉钉机器人请求超时",
        "TIMEOUT",
      );
    }
    throw new DingTalkRobotDeliveryError(
      "钉钉机器人返回了无法识别的响应",
      "INVALID_RESPONSE",
    );
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeTimeout(value?: number) {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(value) || value < 1_000 || value > 30_000) {
    throw new RangeError("钉钉机器人超时时间必须在 1000 到 30000 毫秒之间");
  }
  return Math.round(value);
}

async function readLimitedResponse(response: Response) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    await discardResponse(response);
    throw new DingTalkRobotDeliveryError(
      "钉钉机器人响应内容过大",
      "INVALID_RESPONSE",
    );
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new DingTalkRobotDeliveryError(
        "钉钉机器人响应内容过大",
        "INVALID_RESPONSE",
      );
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

async function discardResponse(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // Response cleanup must not replace the delivery error.
  }
}

function safeRemoteMessage(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .replace(/(access_token=)[^&\s]+/gi, "$1[已隐藏]")
    .replace(/([?&]sign=)[^&\s]+/gi, "$1[已隐藏]")
    .replace(/[\r\n\t\u0000-\u001f]+/g, " ")
    .trim()
    .slice(0, 200);
}
