import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { ExternalActor } from "@/lib/external-actor";
import { withSystemDb } from "@/lib/system-db";
import type { ExternalClientFingerprint } from "@/modules/integrations/external/client-fingerprint";
import { getRegisteredPlugin } from "@/modules/plugins/plugin-registry";
import { DomainError } from "@/modules/projects/errors";

export function hashExternalToken(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}

function embedBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Embed\s+([^\s]+)$/i.exec(authorization);
  if (!match) {
    throw new DomainError(
      "EMBED_SESSION_REQUIRED",
      "请返回原系统后重新进入",
      401,
    );
  }
  return match[1];
}

export async function issueExternalEmbedSession(
  tx: Prisma.TransactionClient,
  input: {
    bindingId: string;
    externalContactId: string;
    expiresAt: Date;
    fingerprint: ExternalClientFingerprint;
    launchMode?: "iframe" | "native";
  },
) {
  const rawToken = randomBytes(32).toString("base64url");
  const session = await tx.externalEmbedSession.create({
    data: {
      tokenHash: hashExternalToken(rawToken),
      bindingId: input.bindingId,
      externalContactId: input.externalContactId,
      expiresAt: input.expiresAt,
      launchMode: input.launchMode ?? "iframe",
      ...input.fingerprint,
    },
    select: { id: true },
  });
  return { rawToken, sessionId: session.id };
}

export function requireExternalSession(request: Request) {
  return loadActiveExternalSession({
    tokenHash: hashExternalToken(embedBearerToken(request)),
  });
}

/**
 * 按会话 id 取会话，只给已验签的短期附件下载链接用（native 门户在系统浏览器里
 * 打开附件时带不了 Authorization 头）。失效判定与 Embed 令牌完全一致。
 */
export function requireExternalSessionById(sessionId: string) {
  return loadActiveExternalSession({ id: sessionId });
}

async function loadActiveExternalSession(
  where: { tokenHash: string } | { id: string },
) {
  const now = new Date();
  const session = await withSystemDb((tx) =>
    tx.externalEmbedSession.findUnique({
      where,
      include: {
        externalContact: true,
        binding: {
          include: {
            plugin: true,
            sub2ApiConnection: true,
            universalConnection: true,
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
  const connection =
    session?.binding.universalConnection ?? session?.binding.sub2ApiConnection;
  if (
    !session ||
    session.revokedAt ||
    session.expiresAt <= now ||
    session.externalContact.status !== "ACTIVE" ||
    session.binding.status !== "ACTIVE" ||
    !session.binding.plugin.enabled ||
    session.binding.plugin.healthStatus !== "READY" ||
    session.binding.project.kind !== "EXTERNAL_INTEGRATION" ||
    !connection
  ) {
    throw new DomainError(
      "EMBED_SESSION_INVALID",
      "会话已失效，请返回原系统后重新进入",
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
    avatarUrl: session.externalContact.avatarUrl,
    sourceKey: session.binding.pluginKey,
    sourceLabel: getRegisteredPlugin(session.binding.pluginKey).manifest.name,
    projectId: session.binding.project.id,
    customerSpaceId: session.binding.project.customerSpaceId,
  };
  return {
    actor,
    sessionId: session.id,
    expiresAt: session.expiresAt,
    launchMode: session.launchMode === "native" ? "native" : "iframe",
    project: session.binding.project,
    connection: {
      emailNotificationsEnabled: connection.emailNotificationsEnabled,
      customerMemberNotificationsEnabled:
        connection.customerMemberNotificationsEnabled,
    },
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
            sub2ApiConnection: { select: { bindingId: true } },
            universalConnection: { select: { bindingId: true } },
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
        session.binding.plugin.healthStatus === "READY" &&
        (session.binding.sub2ApiConnection ||
          session.binding.universalConnection),
    );
  });
}
