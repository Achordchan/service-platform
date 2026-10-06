import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { withSystemDb } from "@/lib/actor";
import type { SystemErrorRecord } from "@/lib/system-error-log";

const TRANSACTION_MAX_WAIT_MS = 2_000;
const TRANSACTION_TIMEOUT_MS = 3_000;

/**
 * 写一条系统报错。永远走自己的系统事务（withSystemDb），不接受外部 tx：
 * 业务事务回滚时日志仍然存在，是 issue #46 的核心验收点。
 */
export async function persistSystemErrorRow(record: SystemErrorRecord) {
  const data = {
    category: record.category,
    errorName: record.errorName,
    source: record.source,
    operation: record.operation ?? null,
    requestMethod: record.requestMethod ?? null,
    requestPath: record.requestPath ?? null,
    actorType: record.actorType ?? null,
    actorId: record.actorId ?? null,
    details: record.details as Prisma.InputJsonValue,
    context: (record.context ?? undefined) as Prisma.InputJsonValue | undefined,
  };
  await withSystemDb(
    (tx) =>
      tx.systemErrorLog.upsert({
        where: { referenceId: record.referenceId },
        create: { referenceId: record.referenceId, ...data },
        // 编号由业务决定的失败（mail_<邮件ID>）重复发生：刷新同一行，不堆积
        update: {
          ...data,
          createdAt: new Date(),
          occurrenceCount: { increment: 1 },
        },
        select: { id: true },
      }),
    { maxWait: TRANSACTION_MAX_WAIT_MS, timeout: TRANSACTION_TIMEOUT_MS },
  );
}
