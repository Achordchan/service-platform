import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { ExternalActor } from "@/lib/external-actor";
import { withSystemDb } from "@/lib/system-db";
import { decryptSecret } from "@/lib/secret-crypto";
import {
  fetchSub2ApiAdminUser,
  jwtExpiryDate,
  verifySub2ApiUser,
} from "@/modules/integrations/sub2api/client";
import { EMBED_SESSION_MAX_AGE_MS } from "@/modules/integrations/sub2api/constants";
import type { sub2ApiExchangeSchema } from "@/modules/integrations/sub2api/schemas";
import { SUB2API_CONNECTOR_PLUGIN_KEY } from "@/modules/plugins/plugin-registry";
import { DomainError } from "@/modules/projects/errors";
import type { z } from "zod";

type ExchangeInput = z.infer<typeof sub2ApiExchangeSchema>;

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Embed\s+([^\s]+)$/i.exec(authorization);
  if (!match) {
    throw new DomainError(
      "EMBED_SESSION_REQUIRED",
      "请返回 Sub2API 后重新进入",
      401,
    );
  }
  return match[1];
}

function requestMetadata(request: Request) {
  return {
    ipAddress:
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      null,
    userAgent: request.headers.get("user-agent")?.slice(0, 500) || null,
  };
}

export async function exchangeSub2ApiIdentity(
  request: Request,
  input: ExchangeInput,
) {
  const binding = await withSystemDb((tx) =>
    tx.projectPluginBinding.findUnique({
      where: { publicId: input.publicId },
      include: {
        plugin: true,
        sub2ApiConnection: true,
        project: {
          select: {
            id: true,
            kind: true,
            status: true,
            customerSpaceId: true,
            title: true,
          },
        },
      },
    }),
  );
  if (
    !binding ||
    binding.pluginKey !== SUB2API_CONNECTOR_PLUGIN_KEY ||
    !binding.plugin.enabled ||
    binding.plugin.healthStatus !== "READY" ||
    binding.status !== "ACTIVE" ||
    binding.project.kind !== "EXTERNAL_INTEGRATION" ||
    !binding.sub2ApiConnection
  ) {
    throw new DomainError(
      "SUB2API_CONNECTION_UNAVAILABLE",
      "当前外部工单入口不可用",
      403,
    );
  }

  const jwtExpiresAt = jwtExpiryDate(input.token);
  const now = new Date();
  if (!jwtExpiresAt || jwtExpiresAt <= now) {
    throw new DomainError(
      "SUB2API_TOKEN_EXPIRED",
      "Sub2API 登录状态已过期，请返回后重新进入",
      401,
    );
  }
  const verified = await verifySub2ApiUser(
    binding.sub2ApiConnection.baseUrl,
    input.token,
  );
  if (verified.id !== input.userId) {
    throw new DomainError(
      "SUB2API_USER_MISMATCH",
      "Sub2API 用户身份不匹配",
      401,
    );
  }

  let profile = verified;
  if (binding.sub2ApiConnection.adminApiKeyEncrypted) {
    try {
      const enriched = await fetchSub2ApiAdminUser(
        binding.sub2ApiConnection.baseUrl,
        decryptSecret(binding.sub2ApiConnection.adminApiKeyEncrypted),
        verified.id,
      );
      if (enriched.id === verified.id) {
        profile = {
          id: verified.id,
          email: enriched.email ?? verified.email,
          username: enriched.username ?? verified.username,
          name: enriched.name || verified.name,
        };
      }
    } catch {
      // Optional enrichment must never block an already verified /auth/me login.
      profile = verified;
    }
  }

  const expiresAt = new Date(
    Math.min(jwtExpiresAt.getTime(), now.getTime() + EMBED_SESSION_MAX_AGE_MS),
  );
  const rawToken = randomBytes(32).toString("base64url");
  const metadata = requestMetadata(request);
  const result = await withSystemDb(async (tx) => {
    const contact = await tx.externalContact.upsert({
      where: {
        bindingId_externalUserId: {
          bindingId: binding.id,
          externalUserId: profile.id,
        },
      },
      create: {
        bindingId: binding.id,
        externalUserId: profile.id,
        email: profile.email,
        username: profile.username,
        displayName: profile.name,
      },
      update: {
        email: profile.email,
        username: profile.username,
        displayName: profile.name,
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
    await tx.externalEmbedSession.create({
      data: {
        tokenHash: tokenHash(rawToken),
        externalContactId: contact.id,
        bindingId: binding.id,
        expiresAt,
        ...metadata,
      },
    });
    await tx.auditLog.createMany({
      data: [{
        action: "SUB2API_EMBED_SESSION_CREATED",
        resourceType: "ExternalEmbedSession",
        externalActorId: contact.id,
        customerSpaceId: binding.project.customerSpaceId,
        projectId: binding.project.id,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        metadata: {
          actorType: "EXTERNAL_CONTACT",
          sourceHost: input.srcHost?.slice(0, 500) ?? null,
          expiresAt: expiresAt.toISOString(),
        },
      }],
    });
    return contact;
  });

  return {
    token: rawToken,
    expiresAt: expiresAt.toISOString(),
    contact: {
      id: result.id,
      externalUserId: result.externalUserId,
      name: result.displayName,
      email: result.email,
      username: result.username,
    },
    project: {
      id: binding.project.id,
      title: binding.project.title,
      status: binding.project.status,
    },
  };
}

export async function requireExternalSession(request: Request) {
  const rawToken = bearerToken(request);
  const now = new Date();
  const session = await withSystemDb((tx) =>
    tx.externalEmbedSession.findUnique({
      where: { tokenHash: tokenHash(rawToken) },
      include: {
        externalContact: true,
        binding: {
          include: {
            plugin: true,
            sub2ApiConnection: true,
            project: {
              select: {
                id: true,
                title: true,
                kind: true,
                status: true,
                customerSpaceId: true,
                serviceTypeId: true,
              },
            },
          },
        },
      },
    }),
  );
  if (
    !session ||
    session.revokedAt ||
    session.expiresAt <= now ||
    session.externalContact.status !== "ACTIVE" ||
    session.binding.status !== "ACTIVE" ||
    !session.binding.plugin.enabled ||
    session.binding.plugin.healthStatus !== "READY" ||
    session.binding.project.kind !== "EXTERNAL_INTEGRATION" ||
    !session.binding.sub2ApiConnection
  ) {
    throw new DomainError(
      "EMBED_SESSION_INVALID",
      "会话已失效，请返回 Sub2API 后重新进入",
      401,
    );
  }
  await withSystemDb((tx) =>
    tx.externalEmbedSession.update({
      where: { id: session.id },
      data: { lastSeenAt: now },
      select: { id: true },
    }),
  );
  const actor: ExternalActor = {
    id: session.externalContact.id,
    bindingId: session.bindingId,
    externalUserId: session.externalContact.externalUserId,
    name: session.externalContact.displayName,
    email: session.externalContact.email,
    username: session.externalContact.username,
    projectId: session.binding.project.id,
    customerSpaceId: session.binding.project.customerSpaceId,
  };
  return {
    actor,
    sessionId: session.id,
    expiresAt: session.expiresAt,
    project: session.binding.project,
    connection: session.binding.sub2ApiConnection,
  };
}

export function isExternalSessionActive(sessionId: string) {
  const now = new Date();
  return withSystemDb(async (tx) => {
    const session = await tx.externalEmbedSession.findUnique({
      where: { id: sessionId },
      select: {
        revokedAt: true,
        expiresAt: true,
        externalContact: { select: { status: true } },
        binding: {
          select: {
            status: true,
            plugin: { select: { enabled: true, healthStatus: true } },
          },
        },
      },
    });
    return Boolean(
      session &&
      !session.revokedAt &&
      session.expiresAt > now &&
      session.externalContact.status === "ACTIVE" &&
      session.binding.status === "ACTIVE" &&
      session.binding.plugin.enabled &&
      session.binding.plugin.healthStatus === "READY",
    );
  });
}
