import "server-only";

import { withSystemDb } from "@/lib/actor";

export const SYSTEM_ERROR_LOG_DEFAULT_RETENTION_DAYS = 90;
const MIN_RETENTION_DAYS = 7;
const MAX_RETENTION_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 保留天数：环境变量 SYSTEM_ERROR_LOG_RETENTION_DAYS 可调，钳在 7～365 天内 */
export function systemErrorLogRetentionDays(
  raw: string | undefined = process.env.SYSTEM_ERROR_LOG_RETENTION_DAYS,
) {
  const parsed = Number(raw);
  if (!raw || !Number.isFinite(parsed)) {
    return SYSTEM_ERROR_LOG_DEFAULT_RETENTION_DAYS;
  }
  return Math.min(
    Math.max(Math.floor(parsed), MIN_RETENTION_DAYS),
    MAX_RETENTION_DAYS,
  );
}

/**
 * 清理过了保留期的系统报错日志，按「最近一次发生时间」（createdAt）算。
 * 走 withSystemDb：DELETE 策略只放行平台管理员上下文。
 */
export function cleanupExpiredSystemErrorLogs(
  retentionDays = systemErrorLogRetentionDays(),
) {
  const cutoff = new Date(Date.now() - retentionDays * DAY_MS);
  return withSystemDb(async (tx) => {
    const result = await tx.systemErrorLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return result.count;
  });
}
