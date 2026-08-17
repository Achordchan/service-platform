import "server-only";

import { withSystemDb } from "@/lib/system-db";

// 每日清理：待绑定票据（过期后保留 1 天供排查）、防暴力计数（1 天）、
// 过期/撤销超 30 天的小程序会话。全部为可再生数据，删除无业务影响。
export function cleanupExpiredMiniappIdentityData() {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return withSystemDb(async (tx) => {
    const tickets = await tx.miniappAuthTicket.deleteMany({
      where: { expiresAt: { lt: oneDayAgo } },
    });
    const guards = await tx.wechatBindGuard.deleteMany({
      where: { updatedAt: { lt: oneDayAgo } },
    });
    const sessions = await tx.miniappSession.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: now } },
          { revokedAt: { lt: thirtyDaysAgo } },
        ],
      },
    });
    return {
      tickets: tickets.count,
      guards: guards.count,
      sessions: sessions.count,
    };
  });
}
