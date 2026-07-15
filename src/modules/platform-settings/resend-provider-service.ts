import "server-only";

import { Resend, type DomainRecords, type WebhookEvent } from "resend";
import { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { env } from "@/lib/runtime-env";
import { decryptSecret, encryptSecret } from "@/lib/secret-crypto";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  ensurePlatformSettings,
} from "@/modules/platform-settings/mail-settings-runtime";
import {
  getPlatformSettings,
} from "@/modules/platform-settings/platform-setting-service";
import { DomainError, assertAllowed } from "@/modules/projects/errors";

export const RESEND_DOMAIN = "mail.achord.cn";
export const RESEND_FROM =
  "服务支持中心 <no-reply@mail.achord.cn>";
export const RESEND_REPLY_TO = "support@achord.cn";

const RESEND_WEBHOOK_EVENTS: WebhookEvent[] = [
  "email.sent",
  "email.delivered",
  "email.delivery_delayed",
  "email.failed",
  "email.bounced",
  "email.complained",
  "email.suppressed",
];

type ResendResult<T> = {
  data: T | null;
  error: { message: string; statusCode: number | null } | null;
};

function unwrap<T>(result: ResendResult<T>, fallback: string) {
  if (result.error || !result.data) {
    throw new DomainError(
      "RESEND_API_ERROR",
      result.error?.message || fallback,
      result.error?.statusCode && result.error.statusCode < 500 ? 422 : 502,
    );
  }
  return result.data;
}

function createResend(apiKey: string) {
  return new Resend(apiKey);
}

function webhookEndpoint(appUrl: string) {
  const endpoint = new URL(
    "/api/v1/webhooks/resend",
    appUrl.replace(/\/$/, "") + "/",
  );
  if (endpoint.protocol !== "https:") {
    throw new DomainError(
      "PUBLIC_HTTPS_URL_REQUIRED",
      "连接 Resend 前，请先把站点地址设置为可公网访问的 HTTPS 域名",
      422,
    );
  }
  return endpoint.toString();
}

function serializeRecords(records: DomainRecords[]) {
  return records.map((record) => ({
    record: record.record,
    name: record.name,
    type: record.type,
    ttl: record.ttl,
    status: record.status,
    value: record.value,
    ...("priority" in record && record.priority !== undefined
      ? { priority: record.priority }
      : {}),
  }));
}

async function reconcileDomain(resend: Resend) {
  const domains = unwrap(
    await resend.domains.list({ limit: 100 }),
    "无法读取 Resend 域名",
  );
  const existing = domains.data.find(
    (domain) => domain.name.toLowerCase() === RESEND_DOMAIN,
  );

  if (!existing) {
    const created = unwrap(
      await resend.domains.create({
        name: RESEND_DOMAIN,
        capabilities: {
          sending: "enabled",
          receiving: "disabled",
        },
      }),
      "创建 Resend 发信域名失败",
    );
    return {
      id: created.id,
      status: created.status,
      records: serializeRecords(created.records),
    };
  }

  const detail = unwrap(
    await resend.domains.get(existing.id),
    "读取 Resend 域名详情失败",
  );
  return {
    id: detail.id,
    status: detail.status,
    records: serializeRecords(detail.records),
  };
}

async function reconcileWebhook(
  resend: Resend,
  endpoint: string,
  current: {
    id: string | null;
    signingSecret: string | null;
  },
) {
  if (current.id && current.signingSecret) {
    const existing = await resend.webhooks.get(current.id);
    if (existing.data) {
      unwrap(
        await resend.webhooks.update(current.id, {
          endpoint,
          events: RESEND_WEBHOOK_EVENTS,
          status: "enabled",
        }),
        "更新 Resend Webhook 失败",
      );
      return {
        id: current.id,
        signingSecret: current.signingSecret,
        status: "enabled",
      };
    }
    if (existing.error && existing.error.statusCode !== 404) {
      throw new DomainError(
        "RESEND_API_ERROR",
        existing.error.message,
        502,
      );
    }
  }

  const webhooks = unwrap(
    await resend.webhooks.list({ limit: 100 }),
    "无法读取 Resend Webhook",
  );
  const matching = webhooks.data.filter(
    (webhook) => webhook.endpoint === endpoint,
  );
  for (const webhook of matching) {
    const removed = await resend.webhooks.remove(webhook.id);
    if (removed.error && removed.error.statusCode !== 404) {
      throw new DomainError(
        "RESEND_WEBHOOK_REPLACE_FAILED",
        removed.error.message,
        502,
      );
    }
  }

  const created = unwrap(
    await resend.webhooks.create({
      endpoint,
      events: RESEND_WEBHOOK_EVENTS,
    }),
    "创建 Resend Webhook 失败",
  );
  return {
    id: created.id,
    signingSecret: created.signing_secret,
    status: "enabled",
  };
}

export async function setupResendProvider(
  actor: Actor,
  input: { apiKey?: string },
) {
  assertAllowed(actor.isPlatformAdmin);
  if (!env.PLATFORM_SECRET_ENCRYPTION_KEY) {
    throw new DomainError(
      "DEDICATED_ENCRYPTION_KEY_REQUIRED",
      "请先在服务器配置 PLATFORM_SECRET_ENCRYPTION_KEY 并重启服务",
      409,
    );
  }
  const current = await ensurePlatformSettings();
  const providedApiKey = input.apiKey?.trim() || null;
  const storedApiKey =
    current.resendApiKeyEncrypted &&
    (!providedApiKey || current.mailMode === "RESEND")
      ? decryptSecret(current.resendApiKeyEncrypted)
      : null;
  const apiKey = providedApiKey || storedApiKey;

  if (!apiKey) {
    throw new DomainError(
      "RESEND_API_KEY_REQUIRED",
      "请填写 Resend API Key",
      422,
    );
  }
  if (
    current.mailMode === "RESEND" &&
    storedApiKey &&
    storedApiKey !== apiKey
  ) {
    throw new DomainError(
      "RESEND_ACTIVE_KEY_LOCKED",
      "请先切换到本地发件箱或 SMTP，再更换 Resend API Key",
      409,
    );
  }

  const resend = createResend(apiKey);
  const endpoint = webhookEndpoint(
    current.appUrl?.trim() || "https://support.achord.cn",
  );
  const domain = await reconcileDomain(resend);
  const reuseStoredWebhook =
    !providedApiKey ||
    (storedApiKey !== null && storedApiKey === providedApiKey);
  const webhook = await reconcileWebhook(resend, endpoint, {
    id: reuseStoredWebhook ? current.resendWebhookId : null,
    signingSecret:
      reuseStoredWebhook && current.resendWebhookSecretEncrypted
        ? decryptSecret(current.resendWebhookSecretEncrypted)
        : null,
  });
  const checkedAt = new Date();

  await withActorDb(actor, async (tx) => {
    await tx.platformSetting.update({
      where: { id: 1 },
      data: {
        mailFrom: RESEND_FROM,
        mailReplyTo: RESEND_REPLY_TO,
        resendApiKeyEncrypted: encryptSecret(apiKey),
        resendDomain: RESEND_DOMAIN,
        resendDomainId: domain.id,
        resendDomainStatus: domain.status,
        resendDnsRecords: domain.records,
        resendWebhookId: webhook.id,
        resendWebhookStatus: webhook.status,
        resendWebhookSecretEncrypted: encryptSecret(
          webhook.signingSecret,
        ),
        resendLastCheckedAt: checkedAt,
        updatedById: actor.id,
      },
    });
    await writeAuditLog(tx, actor, {
      action: "RESEND_PROVIDER_CONFIGURED",
      resourceType: "PlatformSetting",
      resourceId: "1",
      metadata: {
        domain: RESEND_DOMAIN,
        domainStatus: domain.status,
        webhookEndpoint: endpoint,
        apiKeyChanged: Boolean(input.apiKey?.trim()),
      },
    });
  });

  return getPlatformSettings(actor);
}

export async function verifyResendDomain(actor: Actor) {
  assertAllowed(actor.isPlatformAdmin);
  const current = await ensurePlatformSettings();
  if (!current.resendApiKeyEncrypted || !current.resendDomainId) {
    throw new DomainError(
      "RESEND_NOT_CONFIGURED",
      "请先连接 Resend",
      409,
    );
  }

  const resend = createResend(decryptSecret(current.resendApiKeyEncrypted));
  unwrap(
    await resend.domains.verify(current.resendDomainId),
    "发起域名验证失败",
  );
  const detail = unwrap(
    await resend.domains.get(current.resendDomainId),
    "刷新域名状态失败",
  );
  const webhookResult = current.resendWebhookId
    ? await resend.webhooks.get(current.resendWebhookId)
    : null;
  if (
    webhookResult?.error &&
    webhookResult.error.statusCode !== 404
  ) {
    throw new DomainError(
      "RESEND_API_ERROR",
      webhookResult.error.message,
      502,
    );
  }
  const checkedAt = new Date();

  await withActorDb(actor, async (tx) => {
    await tx.platformSetting.update({
      where: { id: 1 },
      data: {
        resendDomainStatus: detail.status,
        resendDnsRecords: serializeRecords(detail.records),
        resendWebhookStatus:
          webhookResult?.data?.status ??
          (current.resendWebhookId ? "missing" : null),
        resendLastCheckedAt: checkedAt,
        updatedById: actor.id,
      },
    });
    await writeAuditLog(tx, actor, {
      action: "RESEND_DOMAIN_VERIFIED",
      resourceType: "PlatformSetting",
      resourceId: "1",
      metadata: {
        domain: detail.name,
        domainStatus: detail.status,
      },
    });
  });

  return getPlatformSettings(actor);
}

export async function disconnectResendProvider(actor: Actor) {
  assertAllowed(actor.isPlatformAdmin);
  const current = await ensurePlatformSettings();

  if (
    current.resendApiKeyEncrypted &&
    current.resendWebhookId
  ) {
    try {
      const resend = createResend(
        decryptSecret(current.resendApiKeyEncrypted),
      );
      const removed = await resend.webhooks.remove(current.resendWebhookId);
      if (removed.error && removed.error.statusCode !== 404) {
        throw new DomainError(
          "RESEND_WEBHOOK_REMOVE_FAILED",
          removed.error.message,
          502,
        );
      }
    } catch (error) {
      if (error instanceof DomainError) throw error;
      // 主密钥丢失时仍允许管理员显式清除已经无法使用的服务凭据。
    }
  }

  await withActorDb(actor, async (tx) => {
    await tx.platformSetting.update({
      where: { id: 1 },
      data: {
        mailMode:
          current.mailMode === "RESEND"
            ? "LOCAL_OUTBOX"
            : current.mailMode,
        resendApiKeyEncrypted: null,
        resendDomainId: null,
        resendDomainStatus: null,
        resendDnsRecords: Prisma.DbNull,
        resendWebhookId: null,
        resendWebhookStatus: null,
        resendWebhookSecretEncrypted: null,
        resendLastCheckedAt: null,
        updatedById: actor.id,
      },
    });
    await writeAuditLog(tx, actor, {
      action: "RESEND_PROVIDER_DISCONNECTED",
      resourceType: "PlatformSetting",
      resourceId: "1",
      metadata: {
        domain: current.resendDomain,
        switchedToLocalOutbox: current.mailMode === "RESEND",
      },
    });
  });

  return getPlatformSettings(actor);
}
