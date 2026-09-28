// 不依赖 Next 运行时：API 路由、后台 worker、启动流程共用
type ErrorRecord = Record<string, unknown>;

const MAX_STACK_FRAMES = 4;
const MAX_MESSAGE_LENGTH = 300;
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
// 引号串识别转义（\" 不算结束），嵌套序列化的 JSON 整段算一个串；可跨行。
// 单引号两侧不能是字母数字，免得把 can't / isn't 当引号
const QUOTED_SPAN =
  /"((?:[^"\\]|\\[\s\S])*)"|(?<![A-Za-z0-9])'((?:[^'\\]|\\[\s\S])*)'(?![A-Za-z0-9])/g;
const SENSITIVE_WORD =
  /^[A-Za-z0-9_-]*(?:password|passwd|passphrase|token|secret|api[_-]?key|access[_-]?key|private[_-]?key|credential|session|authorization|cookie)[A-Za-z0-9_-]*$/i;
const AUTH_SCHEME_WORD = /^(?:bearer|basic|embed|digest)$/i;
// 普通单词：字母（含中文）、数字、下划线、横杠、点，可带英文撇号（can't）
const PLAIN_WORD = /^[\p{L}\p{M}\p{N}_.-]+(?:['’][\p{L}]+)?$/u;
const LEADING_PUNCTUATION = /^[(（[【]+/;
const TRAILING_PUNCTUATION = /[,.;:!?，。；：！？)）\]】]+$/;
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
 * 引号串一律视为可能的用户输入，只保留紧跟 SQL 关键词的标识符（table "Notification"）。
 * 没有配对的双引号从它开始到结尾整段打码（截断或残缺的消息）。
 */
function redactQuotedSpans(value: string) {
  const spans: string[] = [];
  // 先把每个引号串换成占位符，剩下的双引号就是没有配对的
  const masked = value.replace(
    QUOTED_SPAN,
    (match, double: string | undefined, _single: string | undefined, offset: number, whole: string) => {
      const kept =
        double !== undefined &&
        SQL_IDENTIFIER.test(double) &&
        SQL_OBJECT_KEYWORD.test(whole.slice(0, offset));
      spans.push(kept ? match : double !== undefined ? '"[REDACTED]"' : "'[REDACTED]'");
      return `\u0000${spans.length - 1}\u0000`;
    },
  );
  const dangling = masked.indexOf('"');
  const truncated =
    dangling === -1 ? masked : `${masked.slice(0, dangling)}[REDACTED]`;
  return truncated.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => spans[Number(index)]);
}

function looksLikeSecret(word: string) {
  if (!/^[\x00-\x7F]+$/.test(word)) return false;
  const hasLetter = /[A-Za-z]/.test(word);
  const hasDigit = /\d/.test(word);
  return word.length > 32 || (hasLetter && hasDigit && word.length >= 8);
}

/**
 * 逐词白名单：只有普通单词、已审过的 SQL 标识符和打码占位能留下；
 * 带 @ :// = / \\ {} % 等符号的词（URL、连接串、JSON 片段、键值对）整个打码。
 * 敏感键名、认证 scheme 之后的词打码；7 位以上纯数字记成 [NUMBER]。
 */
function redactWords(value: string) {
  let redactNext = false;
  return value
    .split(/(\s+)/)
    .map((part) => {
      if (!part || /^\s+$/.test(part)) return part;
      const leading = part.match(LEADING_PUNCTUATION)?.[0] ?? "";
      const trailing = part.slice(leading.length).match(TRAILING_PUNCTUATION)?.[0] ?? "";
      const core = part.slice(leading.length, part.length - trailing.length);
      const previousWasKey = redactNext;
      redactNext = SENSITIVE_WORD.test(core) || AUTH_SCHEME_WORD.test(core);
      let safe: string;
      if (!core) {
        safe = "";
      } else if (core === '"[REDACTED]"' || core === "'[REDACTED]'" || core === "[REDACTED]") {
        safe = core;
      } else if (/^"[A-Za-z_][A-Za-z0-9_.]{0,127}"$/.test(core)) {
        // 能留到这一步的双引号标识符都已经在 redactQuotedSpans 里过了关键词检查
        safe = core;
      } else if (previousWasKey) {
        safe = "[REDACTED]";
      } else if (/^\+?\d[\d-]{6,}$/.test(core) && (core.match(/\d/g)?.length ?? 0) >= 7) {
        safe = "[NUMBER]";
      } else if (PLAIN_WORD.test(core) && !looksLikeSecret(core)) {
        safe = core;
      } else {
        safe = "[REDACTED]";
      }
      return `${leading}${safe}${trailing}`;
    })
    .join("");
}

/**
 * 错误消息是排查的关键线索（例如 RLS 拒绝时的表名），但可能夹带用户输入和凭据。
 * 默认拒绝：Cookie 头整行、引号串、非普通单词一律打码，只留下可读的句子骨架。
 */
function safeMessage(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const withoutCookies = value
    .replace(COOKIE_HEADER, "$1$2[REDACTED]")
    // 按空格拆词前先把跨空格/横杠分组的号码（+86 138 0013 8000）整体替换
    .replace(LONG_NUMBER, "[NUMBER]");
  const redacted = redactWords(redactQuotedSpans(withoutCookies))
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
