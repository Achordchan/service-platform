import "server-only";

import { withSystemDb } from "@/lib/system-db";
import { decryptSecret } from "@/lib/secret-crypto";
import { issueExternalEmbedSession } from "@/modules/integrations/external/session-service";
import {
  fetchSub2ApiAdminUser,
  jwtExpiryDate,
  verifySub2ApiUser,
} from "@/modules/integrations/sub2api/client";
import { extractSub2ApiClientFingerprint } from "@/modules/integrations/sub2api/client-utils";
import { EMBED_SESSION_MAX_AGE_MS } from "@/modules/integrations/sub2api/constants";
import type { sub2ApiExchangeSchema } from "@/modules/integrations/sub2api/schemas";
import { SUB2API_CONNECTOR_PLUGIN_KEY } from "@/modules/plugins/plugin-registry";
import { DomainError } from "@/modules/projects/errors";
import type { z } from "zod";

type ExchangeInput = z.infer<typeof sub2ApiExchangeSchema>;

function requestMetadata(request: Request) {
  return extractSub2ApiClientFingerprint(request.headers);
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
      "当前外部服务请求入口不可用",
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
  const metadata = requestMetadata(request);
  const verified = await verifySub2ApiUser(
    binding.sub2ApiConnection.baseUrl,
    input.token,
    metadata,
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
    const issued = await issueExternalEmbedSession(tx, {
      bindingId: binding.id,
      externalContactId: contact.id,
      expiresAt,
      fingerprint: metadata,
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
    return { contact, rawToken: issued.rawToken };
  });

  return {
    token: result.rawToken,
    expiresAt: expiresAt.toISOString(),
    contact: {
      id: result.contact.id,
      externalUserId: result.contact.externalUserId,
      name: result.contact.displayName,
      email: result.contact.email,
      username: result.contact.username,
    },
    parentOrigins: [binding.sub2ApiConnection.sourceOrigin],
    project: {
      id: binding.project.id,
      title: binding.project.title,
      status: binding.project.status,
    },
  };
}

export {
  isExternalSessionActive,
  requireExternalSession,
} from "@/modules/integrations/external/session-service";
