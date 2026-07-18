import "server-only";

import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import {
  isDevelopmentLocalHostname,
  isPrivateHostname,
  normalizeWebhookUrl,
} from "@/modules/integrations/external/network-security";
import {
  UNIVERSAL_WEBHOOK_RESPONSE_MAX_BYTES,
  UNIVERSAL_WEBHOOK_TIMEOUT_MS,
} from "@/modules/integrations/universal/constants";
import { DomainError } from "@/modules/projects/errors";
import { createUniversalWebhookSignature } from "@/modules/integrations/universal/webhook-signature";

type PinnedAddress = { address: string; family: number };

async function resolveSafeAddress(hostname: string): Promise<PinnedAddress | null> {
  if (isDevelopmentLocalHostname(hostname)) return null;
  const addresses = await lookup(hostname, { all: true, verbatim: true }).catch(
    () => {
      throw new DomainError(
        "UNIVERSAL_WEBHOOK_DNS_FAILED",
        "Webhook 地址无法解析",
        502,
      );
    },
  );
  if (
    addresses.length === 0 ||
    addresses.some((item) => isPrivateHostname(item.address))
  ) {
    throw new DomainError(
      "UNIVERSAL_WEBHOOK_PRIVATE_ADDRESS",
      "Webhook 地址解析到了本机或内网地址",
      422,
    );
  }
  return addresses.find((item) => item.family === 4) ?? addresses[0];
}

export async function postUniversalWebhook(input: {
  url: string;
  secret: string;
  eventId: string;
  rawBody: string;
}) {
  const target = new URL(normalizeWebhookUrl(input.url));
  const pinned = await resolveSafeAddress(target.hostname);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createUniversalWebhookSignature(
    input.secret,
    timestamp,
    input.rawBody,
  );
  const body = Buffer.from(input.rawBody, "utf8");
  const transport = target.protocol === "https:" ? https : http;

  return new Promise<{ status: number }>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const request = transport.request(
      {
        protocol: target.protocol,
        hostname: pinned?.address ?? target.hostname,
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        method: "POST",
        servername: target.hostname,
        headers: {
          Host: target.host,
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": String(body.byteLength),
          "User-Agent": "Achord-Connect-Webhook/1.0",
          "X-Achord-Event-Id": input.eventId,
          "X-Achord-Timestamp": timestamp,
          "X-Achord-Signature": `v1=${signature}`,
        },
      },
      (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400
        ) {
          response.resume();
          finish(() =>
            reject(
              new DomainError(
                "UNIVERSAL_WEBHOOK_REDIRECT_REJECTED",
                "Webhook 地址返回了重定向",
                502,
              ),
            ),
          );
          return;
        }
        let total = 0;
        response.on("data", (chunk: Buffer) => {
          total += chunk.byteLength;
          if (total > UNIVERSAL_WEBHOOK_RESPONSE_MAX_BYTES) {
            request.destroy();
            finish(() =>
              reject(
                new DomainError(
                  "UNIVERSAL_WEBHOOK_RESPONSE_TOO_LARGE",
                  "Webhook 响应过大",
                  502,
                ),
              ),
            );
          }
        });
        response.on("end", () => {
          const status = response.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            finish(() =>
              reject(
                new DomainError(
                  "UNIVERSAL_WEBHOOK_REQUEST_FAILED",
                  `Webhook 返回 HTTP ${status || "未知"}`,
                  502,
                  { responseStatus: status || null },
                ),
              ),
            );
            return;
          }
          finish(() => resolve({ status }));
        });
      },
    );
    const timer = setTimeout(() => {
      request.destroy();
      finish(() =>
        reject(
          new DomainError(
            "UNIVERSAL_WEBHOOK_TIMEOUT",
            "Webhook 请求超时",
            502,
          ),
        ),
      );
    }, UNIVERSAL_WEBHOOK_TIMEOUT_MS);
    request.on("error", () => {
      finish(() =>
        reject(
          new DomainError(
            "UNIVERSAL_WEBHOOK_UNREACHABLE",
            "Webhook 地址无法连接",
            502,
          ),
        ),
      );
    });
    request.end(body);
  });
}
