import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { env } from "@/lib/runtime-env";
import { withSystemDb } from "@/lib/system-db";
import { extractExternalClientFingerprint } from "@/modules/integrations/external/client-fingerprint";
import { normalizeEmbedOrigin } from "@/modules/integrations/external/network-security";
import { isDevelopmentLocalHostname } from "@/modules/integrations/external/network-security";
import { issueExternalEmbedSession } from "@/modules/integrations/external/session-service";
import { validateUniversalProfileAttributes } from "@/modules/integrations/universal/profile";
import {
  UNIVERSAL_CONNECTION_RATE_LIMIT,
  UNIVERSAL_PLUGIN_KEY,
  UNIVERSAL_RATE_WINDOW_MS,
  UNIVERSAL_SESSION_MAX_AGE_MS,
  UNIVERSAL_TICKET_TTL_MS,
  UNIVERSAL_USER_RATE_LIMIT,
} from "@/modules/integrations/universal/constants";
import type {
  universalExchangeSchema,
  universalLaunchTicketSchema,
  universalProfileFieldSchema,
} from "@/modules/integrations/universal/schemas";
import {
  createUniversalTicket,
  hashUniversalSecret,
  parseUniversalBasicAuth,
  verifyUniversalSecret,
} from "@/modules/integrations/universal/security";
import { DomainError } from "@/modules/projects/errors";
import type { z } from "zod";

type LaunchInput = z.infer<typeof universalLaunchTicketSchema>;
type ExchangeInput = z.infer<typeof universalExchangeSchema>;
type ProfileField = z.infer<typeof universalProfileFieldSchema>;
export type UniversalLaunchAuthentication = { credentialId: string };
const DUMMY_SECRET_HASH = hashUniversalSecret(
  "acs_invalid_credential_timing_equalizer",
);

function parseProfileFields(value: Prisma.JsonValue) {
  return Array.isArray(value) ? (value as ProfileField[]) : [];
}

function normalizeAvatarUrl(value: string | null | undefined) {
  if (!value) return null;
  const url = new URL(value);
  const developmentLocal = isDevelopmentLocalHostname(url.hostname);
  if (
    url.protocol !== "https:" &&
    !(developmentLocal && url.protocol === "http:")
  ) {
    throw new DomainError(
      "UNIVERSAL_AVATAR_HTTPS_REQUIRED",
      "用户头像地址必须使用 HTTPS",
      422,
    );
  }
  return url.toString();
}

function launchUrl(publicId: string, ticket: string) {
  const url = new URL(`/embed/connect/${publicId}`, env.APP_URL);
  return `${url.toString()}#ticket=${encodeURIComponent(ticket)}`;
}

function parseAllowedOrigins(value: Prisma.JsonValue) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function resolveTicketReturnOrigin(
  requestedOrigin: string | undefined,
  allowedOrigins: string[],
) {
  if (!requestedOrigin) {
    if (allowedOrigins.length === 1) return allowedOrigins[0];
    throw new DomainError(
      "UNIVERSAL_RETURN_ORIGIN_REQUIRED",
      "连接配置了多个 Origin，创建票据时必须指定 context.returnOrigin",
      422,
    );
  }
  const normalized = normalizeEmbedOrigin(requestedOrigin);
  if (!allowedOrigins.includes(normalized)) {
    throw new DomainError(
      "UNIVERSAL_RETURN_ORIGIN_INVALID",
      "返回 Origin 不在当前连接的允许范围内",
      403,
    );
  }
  return normalized;
}

export async function authenticateUniversalLaunchRequest(request: Request) {
  const { clientId, clientSecret } = parseUniversalBasicAuth(request);
  return withSystemDb(async (tx): Promise<UniversalLaunchAuthentication> => {
    const credential = await tx.universalConnectorCredential.findUnique({
      where: { clientId },
      include: {
        connection: {
          include: {
            binding: {
              include: {
                plugin: true,
                project: { select: { kind: true } },
              },
            },
          },
        },
      },
    });
    const secretValid = verifyUniversalSecret(
      clientSecret,
      credential?.secretHash ?? DUMMY_SECRET_HASH,
    );
    if (
      !credential ||
      credential.revokedAt ||
      !secretValid ||
      credential.connection.binding.pluginKey !== UNIVERSAL_PLUGIN_KEY ||
      !credential.connection.binding.plugin.enabled ||
      credential.connection.binding.plugin.healthStatus !== "READY" ||
      credential.connection.binding.status !== "ACTIVE" ||
      credential.connection.binding.project.kind !== "EXTERNAL_INTEGRATION" ||
      credential.connection.healthStatus !== "READY"
    ) {
      throw new DomainError(
        "UNIVERSAL_CREDENTIAL_INVALID",
        "Achord Connect 凭据无效或连接未激活",
        401,
      );
    }
    return { credentialId: credential.id };
  });
}

export async function issueUniversalLaunchTicket(
  authentication: UniversalLaunchAuthentication,
  input: LaunchInput,
) {
  const now = new Date();
  const windowStart = new Date(now.getTime() - UNIVERSAL_RATE_WINDOW_MS);
  const generated = createUniversalTicket();
  return withSystemDb(async (tx) => {
    const credential = await tx.universalConnectorCredential.findUnique({
      where: { id: authentication.credentialId },
      include: {
        connection: {
          include: {
            binding: {
              include: {
                plugin: true,
                project: {
                  select: { id: true, kind: true, status: true },
                },
              },
            },
          },
        },
      },
    });
    if (
      !credential ||
      credential.revokedAt ||
      credential.connection.binding.pluginKey !== UNIVERSAL_PLUGIN_KEY ||
      !credential.connection.binding.plugin.enabled ||
      credential.connection.binding.plugin.healthStatus !== "READY" ||
      credential.connection.binding.status !== "ACTIVE" ||
      credential.connection.binding.project.kind !== "EXTERNAL_INTEGRATION" ||
      credential.connection.healthStatus !== "READY"
    ) {
      throw new DomainError(
        "UNIVERSAL_CREDENTIAL_INVALID",
        "Achord Connect 凭据无效或连接未激活",
        401,
      );
    }
    const allowedOrigins = parseAllowedOrigins(
      credential.connection.allowedOrigins,
    );
    const returnOrigin = resolveTicketReturnOrigin(
      input.context.returnOrigin,
      allowedOrigins,
    );
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`achord-connect:${credential.bindingId}`}, 0)
      )
    `;
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(
          ${`achord-connect:${credential.bindingId}:${input.user.id}`},
          0
        )
      )
    `;
    const connectionCount = await tx.universalLaunchTicket.count({
      where: {
        bindingId: credential.bindingId,
        createdAt: { gte: windowStart },
      },
    });
    const userCount = await tx.universalLaunchTicket.count({
      where: {
        bindingId: credential.bindingId,
        externalUserId: input.user.id,
        createdAt: { gte: windowStart },
      },
    });
    if (
      connectionCount >= UNIVERSAL_CONNECTION_RATE_LIMIT ||
      userCount >= UNIVERSAL_USER_RATE_LIMIT
    ) {
      throw new DomainError(
        "UNIVERSAL_RATE_LIMITED",
        "单次接入请求过于频繁，请稍后重试",
        429,
      );
    }
    const attributes = validateUniversalProfileAttributes(
      input.user.attributes,
      parseProfileFields(credential.connection.profileFields),
    );
    const profile = {
      id: input.user.id,
      name: input.user.name,
      email: input.user.email?.trim().toLowerCase() ?? null,
      username: input.user.username?.trim() ?? null,
      avatarUrl: normalizeAvatarUrl(input.user.avatarUrl),
      attributes,
    };
    const expiresAt = new Date(now.getTime() + UNIVERSAL_TICKET_TTL_MS);
    await tx.universalLaunchTicket.create({
      data: {
        bindingId: credential.bindingId,
        ticketHash: generated.ticketHash,
        externalUserId: profile.id,
        profile,
        context: { ...input.context, returnOrigin },
        expiresAt,
      },
    });
    await tx.universalConnectorCredential.update({
      where: { id: credential.id },
      data: { lastUsedAt: now },
    });
    return {
      launchUrl: launchUrl(
        credential.connection.binding.publicId,
        generated.ticket,
      ),
      expiresAt: expiresAt.toISOString(),
    };
  });
}

export async function createUniversalLaunchTicket(
  request: Request,
  input: LaunchInput,
) {
  const authentication = await authenticateUniversalLaunchRequest(request);
  return issueUniversalLaunchTicket(authentication, input);
}

export function cleanupExpiredUniversalLaunchTickets() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return withSystemDb((tx) =>
    tx.universalLaunchTicket.deleteMany({
      where: { expiresAt: { lt: cutoff } },
    }),
  );
}

export async function exchangeUniversalTicket(
  request: Request,
  input: ExchangeInput,
) {
  const now = new Date();
  const fingerprint = extractExternalClientFingerprint(request.headers);
  return withSystemDb(async (tx) => {
    const ticket = await tx.universalLaunchTicket.findUnique({
      where: { ticketHash: hashUniversalSecret(input.ticket) },
      include: {
        connection: {
          include: {
            binding: {
              include: {
                plugin: true,
                project: {
                  select: {
                    id: true,
                    title: true,
                    kind: true,
                    status: true,
                    customerSpaceId: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (
      !ticket ||
      ticket.consumedAt ||
      ticket.expiresAt <= now ||
      ticket.connection.binding.publicId !== input.publicId ||
      ticket.connection.binding.pluginKey !== UNIVERSAL_PLUGIN_KEY ||
      !ticket.connection.binding.plugin.enabled ||
      ticket.connection.binding.plugin.healthStatus !== "READY" ||
      ticket.connection.binding.status !== "ACTIVE" ||
      ticket.connection.binding.project.kind !== "EXTERNAL_INTEGRATION" ||
      ticket.connection.healthStatus !== "READY"
    ) {
      throw new DomainError(
        "UNIVERSAL_TICKET_INVALID",
        "接入票据已失效，请返回原系统重新进入",
        401,
      );
    }
    const allowedOrigins = parseAllowedOrigins(ticket.connection.allowedOrigins);
    const ticketContext = ticket.context as {
      theme?: "light" | "dark" | "system";
      locale?: string;
      returnOrigin?: string;
    };
    const trustedReturnOrigin = ticketContext.returnOrigin
      ? normalizeEmbedOrigin(ticketContext.returnOrigin)
      : allowedOrigins.length === 1
        ? allowedOrigins[0]
        : null;
    if (!trustedReturnOrigin || !allowedOrigins.includes(trustedReturnOrigin)) {
      throw new DomainError(
        "UNIVERSAL_TICKET_RETURN_ORIGIN_INVALID",
        "接入票据缺少可信返回 Origin，请返回原系统重新进入",
        401,
      );
    }
    if (!input.parentOrigin) {
      throw new DomainError(
        "UNIVERSAL_PARENT_ORIGIN_REQUIRED",
        "无法确认 iframe 宿主来源，请返回原系统重新进入",
        403,
      );
    }
    const requestedParentOrigin = normalizeEmbedOrigin(input.parentOrigin);
    if (!allowedOrigins.includes(requestedParentOrigin)) {
      throw new DomainError(
        "UNIVERSAL_PARENT_ORIGIN_INVALID",
        "当前宿主不在允许嵌入范围内",
        403,
      );
    }
    if (requestedParentOrigin !== trustedReturnOrigin) {
      throw new DomainError(
        "UNIVERSAL_PARENT_ORIGIN_MISMATCH",
        "当前宿主与票据指定的返回 Origin 不一致",
        403,
      );
    }
    const consumed = await tx.universalLaunchTicket.updateMany({
      where: {
        id: ticket.id,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) {
      throw new DomainError(
        "UNIVERSAL_TICKET_CONSUMED",
        "接入票据已被使用，请返回原系统重新进入",
        401,
      );
    }
    const profile = ticket.profile as {
      name: string;
      email: string | null;
      username: string | null;
      avatarUrl: string | null;
      attributes: Record<string, string | number | boolean>;
    };
    const contact = await tx.externalContact.upsert({
      where: {
        bindingId_externalUserId: {
          bindingId: ticket.bindingId,
          externalUserId: ticket.externalUserId,
        },
      },
      create: {
        bindingId: ticket.bindingId,
        externalUserId: ticket.externalUserId,
        displayName: profile.name,
        email: profile.email,
        username: profile.username,
        avatarUrl: profile.avatarUrl,
        profileAttributes: profile.attributes,
        lastParentOrigin: trustedReturnOrigin,
      },
      update: {
        displayName: profile.name,
        email: profile.email,
        username: profile.username,
        avatarUrl: profile.avatarUrl,
        profileAttributes: profile.attributes,
        lastParentOrigin: trustedReturnOrigin,
        lastSeenAt: now,
      },
    });
    if (contact.status !== "ACTIVE") {
      throw new DomainError(
        "EXTERNAL_CONTACT_BLOCKED",
        "当前联系人已被停用",
        403,
      );
    }
    const expiresAt = new Date(now.getTime() + UNIVERSAL_SESSION_MAX_AGE_MS);
    const issued = await issueExternalEmbedSession(tx, {
      bindingId: ticket.bindingId,
      externalContactId: contact.id,
      expiresAt,
      fingerprint,
    });
    await tx.auditLog.createMany({
      data: [
        {
          action: "UNIVERSAL_EMBED_SESSION_CREATED",
          resourceType: "ExternalEmbedSession",
          externalActorId: contact.id,
          customerSpaceId: ticket.connection.binding.project.customerSpaceId,
          projectId: ticket.connection.binding.project.id,
          ipAddress: fingerprint.ipAddress,
          userAgent: fingerprint.userAgent,
          metadata: {
            actorType: "EXTERNAL_CONTACT",
            source: UNIVERSAL_PLUGIN_KEY,
            expiresAt: expiresAt.toISOString(),
          },
        },
      ],
    });
    return {
      token: issued.rawToken,
      expiresAt: expiresAt.toISOString(),
      contact: {
        id: contact.id,
        externalUserId: contact.externalUserId,
        name: contact.displayName,
        email: contact.email,
        username: contact.username,
        avatarUrl: contact.avatarUrl,
        attributes: contact.profileAttributes,
      },
      context: ticket.context,
      parentOrigins: allowedOrigins,
      project: {
        id: ticket.connection.binding.project.id,
        title: ticket.connection.binding.project.title,
        status: ticket.connection.binding.project.status,
      },
    };
  });
}
