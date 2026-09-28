// 不依赖 Next 运行时：API 路由、后台 worker、启动流程共用
type ErrorRecord = Record<string, unknown>;

const MAX_STACK_FRAMES = 4;
const MAX_MESSAGE_LENGTH = 300;
const MAX_CAUSE_DEPTH = 2;
const SENSITIVE_LOG_VALUE = /\b(password|passphrase|token|secret|authorization|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi;
const BEARER_VALUE = /\b(bearer|basic|embed)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const EMAIL_VALUE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL_QUERY = /(https?:\/\/[^\s?#"']+)[?#][^\s"']*/gi;
const LONG_NUMBER = /\d{7,}/g;
// 只有紧跟在 table / column / constraint 等关键词后的双引号标识符才保留；
// 其余引号内容（如 invalid input syntax 回显的值）可能是用户输入，一律打码
const QUOTED_VALUE = /(["'])((?:(?!\1).)*)\1/g;
const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_.]{0,127}$/;
const SQL_OBJECT_KEYWORD =
  /\b(table|relation|column|constraint|index|type|function|policy|schema|sequence|view|trigger|role|database|model|field)\s*$/i;

function asRecord(value: unknown): ErrorRecord | null {
  return typeof value === "object" && value !== null
    ? (value as ErrorRecord)
    : null;
}

export function safeIdentifier(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(normalized)
    ? normalized
    : undefined;
}

export function redactSensitiveText(value: string) {
  return value.replace(SENSITIVE_LOG_VALUE, "$1=[REDACTED]");
}

/**
 * 错误消息是排查的关键线索（例如 RLS 拒绝时的表名），但可能夹带用户输入：
 * 去掉凭据、邮箱、长数字、URL 查询串和非标识符的引号内容后截断再记。
 */
function safeMessage(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const redacted = redactSensitiveText(value)
    .replace(BEARER_VALUE, "$1 [REDACTED]")
    .replace(URL_QUERY, "$1?[REDACTED]")
    .replace(EMAIL_VALUE, "[EMAIL]")
    .replace(LONG_NUMBER, "[NUMBER]")
    .replace(
      QUOTED_VALUE,
      (match, quote: string, inner: string, offset: number, whole: string) =>
        quote === '"' &&
        SQL_IDENTIFIER.test(inner) &&
        SQL_OBJECT_KEYWORD.test(whole.slice(0, offset))
          ? match
          : `${quote}[REDACTED]${quote}`,
    )
    .replace(/\s+/g, " ")
    .trim();
  return redacted.length > MAX_MESSAGE_LENGTH
    ? `${redacted.slice(0, MAX_MESSAGE_LENGTH)}…`
    : redacted;
}

function safeSqlState(value: unknown) {
  return typeof value === "string" && /^[0-9A-Z]{5}$/.test(value)
    ? value
    : undefined;
}

function safeSqlIdentifier(value: unknown) {
  return typeof value === "string" && SQL_IDENTIFIER.test(value)
    ? value
    : undefined;
}

/**
 * Prisma driver adapter 把 PostgreSQL 原始错误放在 DriverAdapterError.cause；
 * 经模型方法抛出时再包一层 PrismaClientKnownRequestError.meta.driverAdapterError。
 * 只取 SQLSTATE、错误类别、标识符和脱敏后的消息，不记 DETAIL（可能带整行数据）。
 */
function databaseDiagnostic(error: unknown) {
  const record = asRecord(error);
  const adapterError =
    record?.name === "DriverAdapterError"
      ? record
      : asRecord(asRecord(asRecord(record?.meta)?.driverAdapterError));
  const payload = asRecord(adapterError?.cause);
  if (!payload) return undefined;
  const constraint = asRecord(payload.constraint);
  const constraintFields = Array.isArray(constraint?.fields)
    ? constraint.fields.map(safeSqlIdentifier).filter(Boolean)
    : [];
  const diagnostic = {
    kind: safeIdentifier(payload.kind),
    sqlState: safeSqlState(payload.originalCode) ?? safeSqlState(payload.code),
    message: safeMessage(payload.originalMessage ?? payload.message),
    table: safeSqlIdentifier(payload.table),
    column: safeSqlIdentifier(payload.column),
    constraint: safeSqlIdentifier(constraint?.index),
    constraintFields: constraintFields.length ? constraintFields : undefined,
    hint: safeMessage(payload.hint),
  };
  return Object.fromEntries(
    Object.entries(diagnostic).filter(([, value]) => value !== undefined),
  );
}

// Prisma 自身的错误消息会回显查询参数（可能含用户数据），只用上面的结构化字段
function isPrismaClientError(error: unknown) {
  return error instanceof Error && error.name.startsWith("PrismaClient");
}

function causeChain(error: unknown) {
  const chain: Array<{ name: string; message?: string }> = [];
  let current = error instanceof Error ? error.cause : undefined;
  while (current instanceof Error && chain.length < MAX_CAUSE_DEPTH) {
    chain.push({
      name: safeIdentifier(current.name) ?? "Error",
      ...(isPrismaClientError(current) ? {} : { message: safeMessage(current.message) }),
    });
    current = current.cause;
  }
  return chain;
}

function safePrismaDiagnostic(error: unknown) {
  const record = asRecord(error);
  const code = safeIdentifier(record?.code);
  const meta = asRecord(record?.meta);
  const model = safeIdentifier(meta?.modelName);
  const message = error instanceof Error ? error.message : "";
  const unknownArgument = message.match(/Unknown argument `([A-Za-z][A-Za-z0-9_]*)`/);
  const missingColumn = message.match(
    /The column `([A-Za-z][A-Za-z0-9_.]*)` does not exist/,
  );

  return {
    ...(code ? { code } : {}),
    ...(model ? { model } : {}),
    ...(unknownArgument ? { unknownArgument: unknownArgument[1] } : {}),
    ...(missingColumn ? { missingColumn: missingColumn[1] } : {}),
  };
}

function safeStackFrames(error: unknown) {
  if (!(error instanceof Error) || !error.stack) return [];
  return error.stack
    .split("\n")
    .slice(1, MAX_STACK_FRAMES + 1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => redactSensitiveText(line).slice(0, 320));
}

function errorCategory(
  error: unknown,
  diagnostic: ReturnType<typeof safePrismaDiagnostic>,
  database?: Record<string, unknown>,
) {
  const sqlState = typeof database?.sqlState === "string" ? database.sqlState : "";
  if (sqlState === "42501") return "DATABASE_PERMISSION";
  if (sqlState.startsWith("23")) return "DATABASE_CONSTRAINT";
  if (sqlState === "40001" || sqlState === "40P01") return "DATABASE_CONFLICT";
  if (
    sqlState === "42P01" ||
    sqlState === "42703" ||
    sqlState === "42883" ||
    diagnostic.missingColumn ||
    diagnostic.unknownArgument ||
    diagnostic.code === "P2021" ||
    diagnostic.code === "P2022"
  ) {
    return "DATABASE_SCHEMA";
  }
  if (
    diagnostic.code === "P1000" ||
    diagnostic.code === "P1001" ||
    diagnostic.code === "P1002" ||
    diagnostic.code === "P1017"
  ) {
    return "DATABASE_CONNECTION";
  }
  if (error instanceof SyntaxError) return "INVALID_SERVER_RESPONSE";
  return "UNEXPECTED";
}

/**
 * 任意错误的可记录描述：错误消息与数据库诊断经脱敏后保留，请求体、凭据和
 * 请求头从不进入。API、后台任务和启动流程共用，保证只凭日志就能定位原因。
 */
export function describeErrorForLog(error: unknown) {
  const name =
    error instanceof Error
      ? safeIdentifier(error.name) ?? "Error"
      : "NonErrorThrown";
  const diagnostic = safePrismaDiagnostic(error);
  const database = databaseDiagnostic(error);
  const message = isPrismaClientError(error)
    ? undefined
    : error instanceof Error
      ? safeMessage(error.message)
      : safeMessage(String(error));
  const causes = causeChain(error);
  return {
    name,
    category: errorCategory(error, diagnostic, database),
    ...(message ? { message } : {}),
    ...diagnostic,
    ...(database && Object.keys(database).length ? { database } : {}),
    ...(causes.length ? { causes } : {}),
    stackFrames: safeStackFrames(error),
  };
}
