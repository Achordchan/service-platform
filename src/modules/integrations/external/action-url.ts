import type { Prisma } from "@/generated/prisma/client";

export function resolveUniversalActionUrl(
  lastParentOrigin: string | null | undefined,
  allowedOrigins: Prisma.JsonValue | null | undefined,
) {
  const origins = Array.isArray(allowedOrigins)
    ? allowedOrigins.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  if (lastParentOrigin && origins.includes(lastParentOrigin)) {
    return lastParentOrigin;
  }
  return origins.length === 1 ? origins[0] : null;
}

export const UNIVERSAL_IN_APP_MAIL_NOTICE = "请在应用内打开工单查看回复";

/**
 * 外部联系人邮件怎么引导回去看工单。
 * - 能确定可信网页来源：放「返回原系统」链接
 * - 从没以 iframe 进入过（只用过 Native Launch，lastParentOrigin 为空）且连接没有唯一 Origin：
 *   不放链接，改为提示回到应用内查看，绝不猜一个站点
 * - 有过 iframe 来源但已不在允许列表：沿用旧行为，返回 null 不发
 */
export function resolveUniversalMailAction(
  lastParentOrigin: string | null | undefined,
  allowedOrigins: Prisma.JsonValue | null | undefined,
): { actionUrl: string | null; actionNotice: string | null } | null {
  const actionUrl = resolveUniversalActionUrl(lastParentOrigin, allowedOrigins);
  if (actionUrl) return { actionUrl, actionNotice: null };
  if (!lastParentOrigin) {
    return { actionUrl: null, actionNotice: UNIVERSAL_IN_APP_MAIL_NOTICE };
  }
  return null;
}
