import "server-only";

import {
  CONTENT_CONTACT_RISK_PLUGIN_KEY,
} from "@achord/plugin-content-contact-risk";
import {
  parseContentContactRiskConfig,
  parseContentContactRiskSecrets,
} from "@achord/plugin-content-contact-risk/config";
import {
  ContentRiskProviderError,
  discoverContentRiskModels,
} from "@achord/plugin-content-contact-risk/runtime";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import {
  decryptPluginSecretConfig,
} from "@/modules/plugins/plugin-secret-config";
import { DomainError } from "@/modules/projects/errors";
import { decryptSnapshot } from "@/modules/plugins/content-risk-review-service";

export async function discoverConfiguredContentRiskModels(
  actor: Actor,
  input: { baseUrl?: string; apiKey?: string },
) {
  if (!actor.isPlatformAdmin) {
    throw new DomainError("FORBIDDEN", "仅平台管理员可配置模型", 403);
  }
  const installation = await withActorDb(actor, (tx) =>
    tx.pluginInstallation.findUnique({
      where: { key: CONTENT_CONTACT_RISK_PLUGIN_KEY },
      select: { config: true, secretConfigEncrypted: true },
    }),
  );
  if (!installation) {
    throw new DomainError("PLUGIN_NOT_FOUND", "风控插件未安装", 404);
  }
  const storedConfig = parseContentContactRiskConfig(installation.config);
  const config = parseContentContactRiskConfig({
    ...storedConfig,
    ...(input.baseUrl?.trim() ? { baseUrl: input.baseUrl.trim() } : {}),
  });
  let storedSecrets: unknown = null;
  if (installation.secretConfigEncrypted) {
    storedSecrets = decryptPluginSecretConfig(installation.secretConfigEncrypted);
  }
  const secrets = parseContentContactRiskSecrets(
    input.apiKey?.trim() ? { apiKey: input.apiKey.trim() } : storedSecrets,
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    try {
      return await discoverContentRiskModels(config, secrets, {
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof ContentRiskProviderError) {
        throw contentRiskProviderDomainError(error);
      }
      throw error;
    }
  } finally {
    clearTimeout(timer);
  }
}

function contentRiskProviderDomainError(error: ContentRiskProviderError) {
  const status = error.status;
  if (status === 401) {
    return new DomainError(
      "CONTENT_RISK_PROVIDER_UNAUTHORIZED",
      "API Key 无效，或上游拒绝了模型列表请求",
      422,
    );
  }
  if (status === 403) {
    return new DomainError(
      "CONTENT_RISK_PROVIDER_FORBIDDEN",
      "当前 API Key 没有读取模型列表的权限",
      422,
    );
  }
  if (status === 404) {
    return new DomainError(
      "CONTENT_RISK_PROVIDER_NOT_FOUND",
      "上游未提供 /v1/models 接口，请检查 Base URL",
      422,
    );
  }
  if (status === 429) {
    return new DomainError(
      "CONTENT_RISK_PROVIDER_RATE_LIMITED",
      "上游请求过于频繁，请稍后重新获取模型",
      429,
    );
  }
  if (status !== null && status >= 500) {
    return new DomainError(
      "CONTENT_RISK_PROVIDER_UNAVAILABLE",
      `上游模型服务暂时不可用（HTTP ${status}）`,
      502,
    );
  }
  return new DomainError(
    "CONTENT_RISK_PROVIDER_INVALID_RESPONSE",
    error.message,
    422,
    status === null ? undefined : { providerStatus: status },
  );
}

export async function getContentRiskAdminDashboard(actor: Actor) {
  if (!actor.isPlatformAdmin) {
    throw new DomainError("FORBIDDEN", "仅平台管理员可查看风控记录", 403);
  }
  return withActorDb(actor, async (tx) => {
    const [runtime, counts, reviews] = await Promise.all([
      tx.contentRiskRuntimeState.findUnique({
        where: { pluginKey: CONTENT_CONTACT_RISK_PLUGIN_KEY },
      }),
      tx.contentRiskReview.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      tx.contentRiskReview.findMany({
        orderBy: { createdAt: "desc" },
        take: 30,
        select: {
          id: true,
          targetType: true,
          targetId: true,
          status: true,
          decision: true,
          riskCategories: true,
          decisionReason: true,
          actorName: true,
          actorId: true,
          projectId: true,
          serviceRequestId: true,
          attemptCount: true,
          lastError: true,
          createdAt: true,
          completedAt: true,
          restoredAt: true,
          restoreReason: true,
          contentSnapshotEncrypted: true,
        },
      }),
    ]);
    const serializedReviews = reviews.map((review) => {
      const { contentSnapshotEncrypted, ...safeReview } = review;
      let contentSnapshot = null;
      try {
        contentSnapshot = decryptSnapshot(contentSnapshotEncrypted);
      } catch {
        contentSnapshot = null;
      }
      return {
        ...safeReview,
        contentSnapshot,
        createdAt: review.createdAt.toISOString(),
        completedAt: review.completedAt?.toISOString() ?? null,
        restoredAt: review.restoredAt?.toISOString() ?? null,
        durationMs: review.completedAt
          ? Math.max(0, review.completedAt.getTime() - review.createdAt.getTime())
          : null,
      };
    });
    const completedDurations = serializedReviews.flatMap((review) =>
      typeof review.durationMs === "number" ? [review.durationMs] : [],
    );
    return {
      runtime: runtime
        ? {
            enabledAt: runtime.enabledAt.toISOString(),
            bypassedAt: runtime.bypassedAt?.toISOString() ?? null,
            capabilityReport: runtime.capabilityReport,
          }
        : null,
      counts: Object.fromEntries(
        counts.map((item) => [item.status, item._count._all]),
      ),
      stats: {
        averageDurationMs:
          completedDurations.length > 0
            ? Math.round(
                completedDurations.reduce((sum, value) => sum + value, 0) /
                  completedDurations.length,
              )
            : null,
        sampledCompletedCount: completedDurations.length,
      },
      reviews: serializedReviews,
    };
  });
}
