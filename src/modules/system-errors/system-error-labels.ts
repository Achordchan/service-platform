/** 错误分类（describeErrorForLog 的 category）与排查提示的中文映射，Web 与接口共用 */
export const SYSTEM_ERROR_CATEGORY_LABELS: Record<string, string> = {
  DATABASE_PERMISSION: "数据库权限",
  DATABASE_SCHEMA: "数据库结构",
  DATABASE_CONSTRAINT: "数据库约束",
  DATABASE_CONFLICT: "数据库冲突",
  DATABASE_CONNECTION: "数据库连接",
  INVALID_SERVER_RESPONSE: "响应无效",
  UNEXPECTED: "未预期错误",
};

const CATEGORY_HINTS: Record<string, string> = {
  DATABASE_PERMISSION:
    "数据库行级安全（RLS）拒绝了读写，通常是新表或新字段的策略没放行当前操作者；先看「表」和 SQLSTATE 42501。",
  DATABASE_SCHEMA:
    "代码与数据库结构不一致，常见于迁移没跑完或字段/表缺失；确认生产已执行 prisma migrate deploy。",
  DATABASE_CONSTRAINT:
    "写入违反唯一、非空、外键或检查约束；看「约束」字段定位是哪一条。",
  DATABASE_CONFLICT: "事务冲突或死锁，通常重试即可恢复；频繁出现需排查长事务。",
  DATABASE_CONNECTION: "数据库连接失败或被中断，先检查数据库进程与连接数。",
  INVALID_SERVER_RESPONSE: "调用方期望 JSON 但拿到了别的内容，常见于上游网关错误页。",
  UNEXPECTED: "未归类的错误，从错误类型和代码位置入手。",
};

const ACTOR_TYPE_LABELS: Record<string, string> = {
  STAFF: "员工",
  CUSTOMER: "客户",
  EXTERNAL_CONTACT: "外部联系人",
  SYSTEM: "系统",
};

export function systemErrorCategoryLabel(category: string) {
  return SYSTEM_ERROR_CATEGORY_LABELS[category] ?? category;
}

export function systemErrorCategoryHint(category: string) {
  return CATEGORY_HINTS[category];
}

export function systemErrorActorTypeLabel(actorType: string | null) {
  return actorType ? (ACTOR_TYPE_LABELS[actorType] ?? actorType) : "未识别";
}

type Details = {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  database?: { message?: unknown; sqlState?: unknown; table?: unknown } | null;
};

/** 列表里的一行摘要：优先数据库命中模板的报错，其次应用自己的中文报错，最后退到类型和错误码 */
export function summarizeSystemError(details: unknown, category: string) {
  const record = (details && typeof details === "object" ? details : {}) as Details;
  const database = record.database ?? undefined;
  if (typeof database?.message === "string") return database.message;
  if (typeof record.message === "string") return record.message;
  const parts = [typeof record.name === "string" ? record.name : "Error"];
  if (typeof record.code === "string") parts.push(record.code);
  if (typeof database?.sqlState === "string") parts.push(`SQLSTATE ${database.sqlState}`);
  if (typeof database?.table === "string") parts.push(`表 ${database.table}`);
  return `${parts.join(" · ")}（${systemErrorCategoryLabel(category)}）`;
}
