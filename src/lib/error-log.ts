// 不依赖 Next 运行时：API 路由、后台 worker、启动流程共用
type ErrorRecord = Record<string, unknown>;

const MAX_STACK_FRAMES = 4;
const MAX_CAUSE_DEPTH = 2;
// scheme://user:password@host —— 覆盖 postgres / redis / amqp / http 等所有连接串
// userinfo 取到最后一个 @：密码里可以有未转义的 @（p@ss@host），PostgreSQL 按最后一个分隔
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#"']*@/gi;
// Cookie 头里多个键值用分号分隔，按键值匹配只能抹掉第一个：整行抹掉
const COOKIE_HEADER = /\b((?:set-)?cookie)(\s*[:=]\s*)[^\r\n]*/gi;
// 认证头的值可能带 scheme 前缀（Bearer xxx），要连同前缀后的令牌一起抹掉
const AUTH_HEADER_VALUE =
  /\b((?:proxy-)?authorization)(["']?\s*[:=]\s*)((?:(?:bearer|basic|embed|digest|token)\s+)?)("[^"]*"|'[^']*'|[^\s,;]+)/gi;
const AUTH_SCHEME_VALUE = /\b(bearer|basic|embed|digest)\s+[A-Za-z0-9._~+/=-]{6,}/gi;
const SENSITIVE_KEY_VALUE =
  /\b([A-Za-z0-9_-]*(?:password|passwd|passphrase|token|secret|api[_-]?key|access[_-]?key|private[_-]?key|credential|session)[A-Za-z0-9_-]*)(["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&"']+)/gi;
const EMAIL_VALUE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// 没有键名也能认出来的令牌：JWT、常见服务商密钥前缀
const JWT_VALUE = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g;
const PREFIXED_KEY_VALUE =
  /\b(?:sk|pk|rk|ghp|gho|ghu|ghs|github_pat|xox[abpr]|AKIA)[-_]?[A-Za-z0-9_-]{16,}/g;
// 7 位以上数字，含带空格或横杠分组的手机号（138-0013-8000）
const LONG_NUMBER = /(?<![\w.])\+?\d(?:[\s-]?\d){6,}(?![\w.])/g;
const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_.]{0,127}$/;
const ID = String.raw`[A-Za-z_][A-Za-z0-9_.]{0,127}`;
/**
 * 数据库报错原文只在完整匹配这些 PostgreSQL 模板时才记录：模板里出现的只有
 * 标识符（表、列、约束名），用户数据只会出现在 DETAIL 或引号值里，而这些都不匹配。
 * 我们自己 SQL 函数里 RAISE EXCEPTION 的固定短语另见 OWN_DATABASE_MESSAGES。
 */
const DATABASE_MESSAGE_TEMPLATES = [
  `new row violates row-level security policy (?:"${ID}" )?for table "${ID}"`,
  `permission denied for (?:table|relation|function|schema|sequence|view) ${ID}`,
  `duplicate key value violates unique constraint "${ID}"`,
  `insert or update on table "${ID}" violates foreign key constraint "${ID}"`,
  `update or delete on table "${ID}" violates foreign key constraint "${ID}" on table "${ID}"`,
  `null value in column "${ID}"(?: of relation "${ID}")? violates not-null constraint`,
  `new row for relation "${ID}" violates check constraint "${ID}"`,
  `relation "${ID}" does not exist`,
  `column "?${ID}"?(?: of relation "${ID}")? does not exist`,
  `function ${ID}\\([A-Za-z0-9_ ,."[\\]]*\\) does not exist`,
  `deadlock detected`,
  `could not serialize access due to [a-z ]+`,
  `canceling statement due to [a-z ]+`,
].map((template) => new RegExp(`^${template}$`));
// 迁移里 RAISE EXCEPTION 的字面量短语逐条列出（带 % 参数的动态消息不在此列）；
// 新增固定短语时同步加到这里，否则只会记 SQLSTATE
const OWN_DATABASE_MESSAGES = new Set([
  "authenticated user context is required",
  "customers cannot archive or restore service requests",
  "customers cannot change milestone attachment ownership",
  "customers cannot modify project configuration",
  "external contact cannot modify protected contact fields",
  "external contact cannot modify protected embed session fields",
  "external contact cannot modify protected service request fields",
  "external contact cannot modify this attachment",
  "milestone attachment must belong to the same project",
  "project progress scope denied",
  "request notification scope denied",
]);

/**
 * 明确声明「消息是代码里写死的固定文字」的错误。只有它的 message 会进日志；
 * 普通 Error 的 message 可能来自第三方或拼接了外部输入，一律不记。
 */
export class LoggableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LoggableError";
  }
}

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

// 替换值时保留原来的引号和分隔符：吃掉引号会让后面的引号错位配对，
// 把本该打码的字段漏到引号外面
function keepQuotes(value: string) {
  const quote = value[0] === '"' || value[0] === "'" ? value[0] : "";
  return `${quote}[REDACTED]${quote}`;
}

/** 凭据类脱敏：URL 账号密码、Cookie、认证头、敏感键值。堆栈、路径、消息共用。 */
export function redactSensitiveText(value: string) {
  return value
    .replace(URL_USERINFO, "$1[REDACTED]@")
    .replace(COOKIE_HEADER, "$1$2[REDACTED]")
    .replace(
      AUTH_HEADER_VALUE,
      (_match, key: string, separator: string, scheme: string, raw: string) =>
        `${key}${separator}${scheme}${keepQuotes(raw)}`,
    )
    .replace(AUTH_SCHEME_VALUE, "$1 [REDACTED]")
    .replace(
      SENSITIVE_KEY_VALUE,
      (_match, key: string, separator: string, raw: string) =>
        `${key}${separator}${keepQuotes(raw)}`,
    )
    .replace(JWT_VALUE, "[REDACTED]")
    .replace(PREFIXED_KEY_VALUE, "[REDACTED]")
    .replace(EMAIL_VALUE, "[EMAIL]");
}

/** 长数字串（手机号、证件号）打码；只给自由文本用，ID 类字段别用，会把纯数字 ID 抹掉 */
export function redactLongNumbers(value: string) {
  return value.replace(LONG_NUMBER, "[NUMBER]");
}

/** 请求路径可能带外部用户 ID（常是邮箱），先解码 %40 之类再脱敏 */
export function redactPath(pathname: string) {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // 非法转义就按原样脱敏
  }
  return redactSensitiveText(decoded).replace(LONG_NUMBER, "[NUMBER]");
}

/**
 * 错误消息默认不记：第三方和驱动返回的原文可能夹带凭据或用户数据，
 * 按字符特征判断也证明不了安全。只有显式抛出的 LoggableError 才记原文。
 */
function appMessage(error: unknown) {
  return error instanceof LoggableError ? error.message.slice(0, 200) : undefined;
}

function databaseMessage(value: unknown) {
  if (typeof value !== "string") return undefined;
  const message = value.trim();
  return OWN_DATABASE_MESSAGES.has(message) ||
    DATABASE_MESSAGE_TEMPLATES.some((template) => template.test(message))
    ? message
    : undefined;
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
 * 只取 SQLSTATE、错误类别、标识符和命中模板的消息；DETAIL、HINT 一律不记。
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
    message: databaseMessage(payload.originalMessage ?? payload.message),
    table: safeSqlIdentifier(payload.table),
    column: safeSqlIdentifier(payload.column),
    constraint: safeSqlIdentifier(constraint?.index),
    constraintFields: constraintFields.length ? constraintFields : undefined,
  };
  return Object.fromEntries(
    Object.entries(diagnostic).filter(([, value]) => value !== undefined),
  );
}

function causeChain(error: unknown) {
  const chain: Array<{ name: string; message?: string; database?: Record<string, unknown> }> = [];
  let current = error instanceof Error ? error.cause : undefined;
  while (current instanceof Error && chain.length < MAX_CAUSE_DEPTH) {
    const message = appMessage(current);
    const database = databaseDiagnostic(current);
    chain.push({
      name: safeIdentifier(current.name) ?? "Error",
      ...(message ? { message } : {}),
      ...(database && Object.keys(database).length ? { database } : {}),
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

// 只认 V8 标准帧格式：`at 函数名 (位置:行:列)` 或 `at 位置:行:列`
const STACK_FRAME =
  /^at (?:(?:async |new )?[^\s()]+(?: \[as [^\]\s]+\])? \()?[^\s()]+:\d+:\d+\)?$/;

function safeStackFrames(error: unknown) {
  if (!(error instanceof Error) || !error.stack) return [];
  // stack 开头会原样重复错误消息，必须先整段去掉，否则多行消息里以 at 开头的行会被当成帧；
  // 消息在 stack 里找不到（事后改过 message 或手写的 stack）就不记帧
  const messageEnd = error.stack.indexOf(error.message);
  if (messageEnd < 0) return [];
  return error.stack
    .slice(messageEnd + error.message.length)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => STACK_FRAME.test(line))
    .slice(0, MAX_STACK_FRAMES)
    // 位置里的查询串可能带参数，一律去掉（一直删到末尾的 :行:列）
    .map((line) =>
      redactSensitiveText(line.replace(/[?#][^\s()]*?(?=:\d+:\d+\)?$)/, "")).slice(0, 320),
    );
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
 * 任意错误的可记录描述：错误类型、分类、Prisma 错误码、数据库诊断（SQLSTATE、
 * 标识符、命中模板的报错原文）、应用自己的中文报错和代码位置。第三方返回的错误
 * 原文、请求体、凭据和请求头从不进入。API、后台任务和启动流程共用。
 */
export function describeErrorForLog(error: unknown) {
  const name =
    error instanceof Error
      ? safeIdentifier(error.name) ?? "Error"
      : "NonErrorThrown";
  const diagnostic = safePrismaDiagnostic(error);
  const database = databaseDiagnostic(error);
  const message = appMessage(error);
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
