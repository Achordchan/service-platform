import "server-only";

import { withSystemDb } from "@/lib/system-db";

/**
 * 在线记录的保留期。离线后不立刻删，是因为「客户设备与网络」要靠这些行
 * 回答「他用什么端、什么 IP、什么时候来过」—— 人走了才去排查是常态。
 */
export const PRESENCE_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * 全局清理过了保留期的在线记录（平台用户 + 外部门户联系人）。
 *
 * 必须是定时任务，不能只靠 updateRequestPresence 里那次顺带清理：那条只在有人
 * 再次心跳时才跑、且只清当前这一个工单。工单一旦结束或没人再打开，行就永远留着；
 * 而每次重新挂载又会生成新的 sessionId —— 既超出声明的保留期，表也会一直涨，
 * 且留的是 IP / UA 这类不该长期堆着的数据。
 */
export function cleanupExpiredRequestPresence() {
  const cutoff = new Date(Date.now() - PRESENCE_RETENTION_MS);
  return withSystemDb(async (tx) => {
    // 必须走 SECURITY DEFINER 函数，不能直接 deleteMany：
    // request_presence_delete 策略要求 "userId" = app_user_id()，而这里跑在
    // withSystemDb（app.user_id = 'system'）下，即使 is_platform_admin 为 true
    // 也匹配不上 —— 删除会被 RLS 静默过滤成 0 行。更隐蔽的是外部联系人那张表
    // 策略不同、反而清得掉，任务看起来「在工作」，实际平台用户的行一条没少。
    const [row] = await tx.$queryRaw<
      Array<{ internal_deleted: bigint; external_deleted: bigint }>
    >`SELECT * FROM app_sweep_expired_request_presence(${cutoff})`;
    return {
      internal: Number(row?.internal_deleted ?? 0),
      external: Number(row?.external_deleted ?? 0),
    };
  });
}
