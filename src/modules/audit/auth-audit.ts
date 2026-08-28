import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { withSystemDb } from "@/lib/actor";

/**
 * 认证类审计事件。区别于业务 writeAuditLog（在请求 actor 事务内写入），认证事件
 * 由 better-auth 钩子触发、发生在正常 actor 事务之外，这里用 withSystemDb 独立事务写入
 * （系统 actor 为平台管理员，满足 audit_log_access 的 WITH CHECK 策略）。
 *
 * 铁律：审计失败绝不能影响登录/登出本身，因此整体 try/catch 吞掉异常并记日志。
 *
 * actor 与 target 分离：
 * - actorUserId：**已认证**的操作者 → 写入 actorId。仅当确实是本人已鉴权的动作
 *   （登录成功、登出）才设置。
 * - targetUserId：动作**指向的账号** → 写入 resourceId。可在无认证操作者时单独存在，
 *   例如未认证的「忘记密码」重置请求——任何人都能替他人邮箱触发，不能记成本人所为。
 */
export type AuthAuditAction =
  | "USER_LOGIN"
  | "USER_LOGOUT"
  | "USER_LOGIN_FAILED"
  | "USER_PASSWORD_RESET_REQUESTED";

type AuthAuditInput = {
  action: AuthAuditAction;
  /** 已认证的操作者（本人）→ actorId。未认证动作留空。 */
  actorUserId?: string | null;
  /** 动作指向的账号 → resourceId。 */
  targetUserId?: string | null;
  /** 登录失败等未认证场景记录被尝试的邮箱（仅入 metadata 便于排查）。 */
  email?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  result?: "SUCCESS" | "FAILURE";
  metadata?: Record<string, unknown>;
};

export async function recordAuthEvent(input: AuthAuditInput): Promise<void> {
  try {
    const metadata: Record<string, unknown> = { ...(input.metadata ?? {}) };
    if (input.email) metadata.email = input.email;

    await withSystemDb((tx) =>
      tx.auditLog.createMany({
        data: [
          {
            action: input.action,
            resourceType: "User",
            resourceId: input.targetUserId ?? undefined,
            result: input.result ?? "SUCCESS",
            ipAddress: input.ipAddress ?? undefined,
            userAgent: input.userAgent ?? undefined,
            // 未认证动作（登录失败、忘记密码）actorId 保持空，不能归到目标账号名下
            actorId: input.actorUserId ?? undefined,
            metadata:
              Object.keys(metadata).length > 0
                ? (metadata as Prisma.InputJsonValue)
                : undefined,
          },
        ],
      }),
    );
  } catch (error) {
    console.error(
      "ACHORD_AUTH_AUDIT_FAILED",
      JSON.stringify({
        event: "auth.audit_write_failed",
        action: input.action,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}
