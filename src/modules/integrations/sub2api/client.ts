import "server-only";

import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import {
  SUB2API_REQUEST_TIMEOUT_MS,
  SUB2API_RESPONSE_MAX_BYTES,
} from "@/modules/integrations/sub2api/constants";
import { DomainError } from "@/modules/projects/errors";
import {
  createSub2ApiRequestIdentity,
  isDevelopmentLocalHostname,
  isPrivateHostname,
  normalizeSub2ApiUser,
  type Sub2ApiPinnedAddress,
} from "@/modules/integrations/sub2api/client-utils";

export {
  jwtExpiryDate,
  normalizeSub2ApiBaseUrl,
  normalizeSub2ApiUser,
  type Sub2ApiUser,
} from "@/modules/integrations/sub2api/client-utils";

async function resolveSafeAddresses(
  hostname: string,
): Promise<Sub2ApiPinnedAddress[]> {
  const addresses = await lookup(hostname, { all: true, verbatim: true }).catch(() => {
    throw new DomainError("SUB2API_DNS_FAILED", "无法解析 Sub2API 地址", 502);
  });
  if (
    addresses.length === 0 ||
    addresses.some((address) => isPrivateHostname(address.address))
  ) {
    throw new DomainError(
      "SUB2API_PRIVATE_ADDRESS_REJECTED",
      "Sub2API 地址解析到了本机或内网地址",
      422,
    );
  }
  return addresses;
}

function parseJsonBody(statusCode: number, body: string) {
  if (Buffer.byteLength(body, "utf8") > SUB2API_RESPONSE_MAX_BYTES) {
    throw new DomainError("SUB2API_RESPONSE_TOO_LARGE", "Sub2API 响应过大", 502);
  }
  if (statusCode < 200 || statusCode >= 300) {
    throw new DomainError(
      statusCode === 401 ? "SUB2API_AUTH_FAILED" : "SUB2API_REQUEST_FAILED",
      statusCode === 401 ? "Sub2API 身份验证失败" : "Sub2API 请求失败",
      statusCode === 401 ? 401 : 502,
    );
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new DomainError("SUB2API_INVALID_RESPONSE", "Sub2API 返回了无效数据", 502);
  }
}

function headersToRecord(headers: HeadersInit | undefined) {
  const result: Record<string, string> = { Accept: "application/json" };
  if (!headers) return result;
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) result[key] = value;
    return result;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") result[key] = value;
  }
  return result;
}

async function fetchSub2ApiJson(
  baseUrl: string,
  path: string,
  headers: HeadersInit,
) {
  const target = new URL(path, `${baseUrl}/`);
  if (target.origin !== new URL(baseUrl).origin) {
    throw new DomainError("SUB2API_ORIGIN_MISMATCH", "Sub2API 请求来源不匹配", 500);
  }
  const developmentLocal = isDevelopmentLocalHostname(target.hostname);
  if (!developmentLocal && isPrivateHostname(target.hostname)) {
    throw new DomainError(
      "SUB2API_PRIVATE_ADDRESS_REJECTED",
      "Sub2API 地址不能指向本机或内网地址",
      422,
    );
  }

  let pinned: Sub2ApiPinnedAddress | null = null;
  if (!developmentLocal) {
    const addresses = await resolveSafeAddresses(target.hostname);
    pinned =
      addresses.find((item) => item.family === 4) ??
      addresses[0] ??
      null;
    if (!pinned) {
      throw new DomainError("SUB2API_DNS_FAILED", "无法解析 Sub2API 地址", 502);
    }
  }

  const transport = target.protocol === "https:" ? https : http;
  const requestHeaders = headersToRecord(headers);
  const requestIdentity = createSub2ApiRequestIdentity(target, pinned);
  requestHeaders.Host = requestIdentity.hostHeader;

  return await new Promise<unknown>((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const succeed = (value: unknown) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const absoluteTimer = setTimeout(() => {
      fail(new DomainError("SUB2API_UNREACHABLE", "无法连接 Sub2API", 502));
      request.destroy();
    }, SUB2API_REQUEST_TIMEOUT_MS);
    const request = transport.request(
      {
        protocol: target.protocol,
        hostname: requestIdentity.hostname,
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        method: "GET",
        headers: requestHeaders,
        servername: requestIdentity.servername,
      },
      (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400
        ) {
          clearTimeout(absoluteTimer);
          fail(
            new DomainError(
              "SUB2API_REDIRECT_REJECTED",
              "Sub2API 地址发生了重定向",
              502,
            ),
          );
          response.resume();
          return;
        }
        const contentLength = Number(response.headers["content-length"] ?? 0);
        if (contentLength > SUB2API_RESPONSE_MAX_BYTES) {
          clearTimeout(absoluteTimer);
          fail(
            new DomainError(
              "SUB2API_RESPONSE_TOO_LARGE",
              "Sub2API 响应过大",
              502,
            ),
          );
          response.resume();
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        response.on("data", (chunk: Buffer) => {
          total += chunk.byteLength;
          if (total > SUB2API_RESPONSE_MAX_BYTES) {
            clearTimeout(absoluteTimer);
            fail(
              new DomainError(
                "SUB2API_RESPONSE_TOO_LARGE",
                "Sub2API 响应过大",
                502,
              ),
            );
            request.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          clearTimeout(absoluteTimer);
          try {
            succeed(
              parseJsonBody(
                response.statusCode ?? 0,
                Buffer.concat(chunks).toString("utf8"),
              ),
            );
          } catch (error) {
            fail(error instanceof Error ? error : new Error("Sub2API 请求失败"));
          }
        });
      },
    );
    request.setTimeout(SUB2API_REQUEST_TIMEOUT_MS, () => {
      clearTimeout(absoluteTimer);
      fail(new DomainError("SUB2API_UNREACHABLE", "无法连接 Sub2API", 502));
      request.destroy();
    });
    request.on("error", (error) => {
      clearTimeout(absoluteTimer);
      if (error instanceof DomainError) {
        fail(error);
        return;
      }
      fail(new DomainError("SUB2API_UNREACHABLE", "无法连接 Sub2API", 502));
    });
    request.end();
  });
}

export async function verifySub2ApiUser(baseUrl: string, token: string) {
  return normalizeSub2ApiUser(
    await fetchSub2ApiJson(baseUrl, "/api/v1/auth/me", {
      Authorization: `Bearer ${token}`,
    }),
  );
}

export async function fetchSub2ApiAdminUser(
  baseUrl: string,
  adminApiKey: string,
  userId: string,
) {
  return normalizeSub2ApiUser(
    await fetchSub2ApiJson(baseUrl, `/api/v1/admin/users/${encodeURIComponent(userId)}`, {
      "x-api-key": adminApiKey,
    }),
  );
}

export async function checkSub2ApiConnection(
  baseUrl: string,
  adminApiKey?: string | null,
) {
  await fetchSub2ApiJson(baseUrl, "/api/v1/settings/public", {});
  if (adminApiKey) {
    await fetchSub2ApiJson(baseUrl, "/api/v1/admin/users?page=1&page_size=1", {
      "x-api-key": adminApiKey,
    });
  }
  return {
    publicApi: "ready",
    adminApi: adminApiKey ? "ready" : "not-configured",
  };
}
