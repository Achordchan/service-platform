import { randomUUID } from "node:crypto";
import {
  describeErrorForLog,
  redactPath,
  redactSensitiveText,
  safeIdentifier,
} from "@/lib/error-log";

/**
 * 系统报错落库：让平台管理员在后台按错误编号查原因，不必登录服务器翻日志。
 *
 * 三条硬约束（issue #46 的验收点）：
 * 1. 不随业务事务回滚：永远开自己的事务，不接受外部 tx。建单事务整体回滚的事故里，
 *    写在同一事务里的日志会一起丢，正是我们要排查的那种错误。
 * 2. 写日志失败只能降级为 console.error，绝不影响原请求或后台任务。
 * 3. 只存 describeErrorForLog 脱敏后的结果，不存请求体、请求头、DETAIL。
 */

export type SystemErrorActorType =
  | "STAFF"
  | "CUSTOMER"
  | "EXTERNAL_CONTACT"
  | "SYSTEM";

export type SystemErrorActor = {
  type: SystemErrorActorType;
  id?: string;
};

export type SystemErrorInput = {
  /** 发生位置：project-api / mail-worker 等 */
  source: string;
  /** 具体操作：audit_logs.list / mail.queue_failed 等 */
  operation?: string;
  /** 不传则生成 err_ 前缀的随机编号；业务自己决定编号（如 mail_<邮件ID>）时传入 */
  referenceId?: string;
  request?: { method?: string; path?: string };
  actor?: SystemErrorActor;
  /** 业务标识（mailMessageId 等），只留标量并脱敏 */
  context?: Record<string, unknown>;
  /** console.error 的第一个参数，沿用现有日志事件名，journalctl 检索习惯不变 */
  logLabel?: string;
  /** 日志 JSON 里的 event 字段，缺省 system.error */
  event?: string;
};

export const SYSTEM_ERROR_REFERENCE_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;

const MAX_CONTEXT_ENTRIES = 12;
const MAX_CONTEXT_VALUE_LENGTH = 200;
const MAX_PATH_LENGTH = 320;
// 数据库不可用时写日志不能把 500 响应或 worker 拖住
const PERSIST_TIMEOUT_MS = 3_000;
const ACTOR_LOOKUP_TIMEOUT_MS = 1_500;
// 错误风暴保护：每个进程每分钟最多落库这么多条，超出的只进 console
const MAX_PERSISTED_PER_WINDOW = 120;
const THROTTLE_WINDOW_MS = 60_000;

export function newSystemErrorReferenceId() {
  return `err_${randomUUID().replaceAll("-", "")}`;
}

// PostgreSQL 的 text / jsonb 都不接受 NUL，其余控制字符进日志也只会弄乱导出。
// 请求路径会被解码（%00 → NUL），攻击者随手构造一个就能让整条日志写不进去，所以入库前统一清掉
function stripControlChars(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]/g, "");
}

function cleanDetails<T>(details: T): T {
  return JSON.parse(
    JSON.stringify(details, (_key, value: unknown) =>
      typeof value === "string" ? stripControlChars(value) : value,
    ),
  ) as T;
}

function safeContext(context?: Record<string, unknown>) {
  if (!context) return undefined;
  const entries: Array<[string, string | number | boolean]> = [];
  for (const [rawKey, value] of Object.entries(context)) {
    if (entries.length >= MAX_CONTEXT_ENTRIES) break;
    const key = safeIdentifier(rawKey);
    if (!key) continue;
    if (typeof value === "string") {
      entries.push([
        key,
        stripControlChars(redactSensitiveText(value)).slice(0, MAX_CONTEXT_VALUE_LENGTH),
      ]);
    } else if (typeof value === "number" || typeof value === "boolean") {
      entries.push([key, value]);
    }
  }
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** 纯函数：把错误和上下文整理成可落库、可打印的记录，便于单测脱敏边界 */
export function buildSystemErrorRecord(error: unknown, input: SystemErrorInput) {
  const referenceId =
    input.referenceId && SYSTEM_ERROR_REFERENCE_PATTERN.test(input.referenceId)
      ? input.referenceId
      : newSystemErrorReferenceId();
  const details = cleanDetails(describeErrorForLog(error));
  const method = input.request?.method
    ? stripControlChars(input.request.method).slice(0, 16)
    : undefined;
  // 查询串和片段可能带令牌、请求参数，只记路径本身；调用方传进来什么都先去掉
  const rawPath = input.request?.path?.split(/[?#]/, 1)[0];
  const path = rawPath
    ? stripControlChars(redactPath(rawPath)).slice(0, MAX_PATH_LENGTH)
    : undefined;
  const actorId = input.actor?.id
    ? stripControlChars(input.actor.id).slice(0, 128)
    : undefined;
  return {
    referenceId,
    category: details.category,
    errorName: details.name,
    source: safeIdentifier(input.source) ?? "unknown",
    operation: safeIdentifier(input.operation),
    requestMethod: method,
    requestPath: path,
    actorType: input.actor?.type,
    actorId,
    details,
    context: safeContext(input.context),
  };
}

export type SystemErrorRecord = ReturnType<typeof buildSystemErrorRecord>;

let windowStartedAt = 0;
let windowCount = 0;
let throttledInWindow = 0;

function takePersistSlot(now = Date.now()) {
  if (now - windowStartedAt >= THROTTLE_WINDOW_MS) {
    if (throttledInWindow > 0) {
      console.error(
        "ACHORD_SYSTEM_ERROR_LOG_THROTTLED",
        JSON.stringify({ dropped: throttledInWindow }),
      );
    }
    windowStartedAt = now;
    windowCount = 0;
    throttledInWindow = 0;
  }
  if (windowCount >= MAX_PERSISTED_PER_WINDOW) {
    throttledInWindow += 1;
    return false;
  }
  windowCount += 1;
  return true;
}

/** 仅供测试：重置错误风暴保护的计数窗口 */
export function resetSystemErrorThrottleForTest() {
  windowStartedAt = 0;
  windowCount = 0;
  throttledInWindow = 0;
}

function consoleLine(record: SystemErrorRecord, input: SystemErrorInput) {
  const label = input.logLabel ?? "ACHORD_SYSTEM_ERROR";
  console.error(
    label,
    JSON.stringify({
      event: input.event ?? "system.error",
      referenceId: record.referenceId,
      source: record.source,
      ...(record.operation ? { operation: record.operation } : {}),
      ...(record.requestMethod || record.requestPath
        ? {
            request: {
              ...(record.requestMethod ? { method: record.requestMethod } : {}),
              ...(record.requestPath ? { path: record.requestPath } : {}),
            },
          }
        : {}),
      ...(record.context ? { context: record.context } : {}),
      error: record.details,
    }),
  );
}

function withTimeout<T>(task: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("system error log step timed out")), ms);
    timer.unref?.();
  });
  return Promise.race([task, timeout]).finally(() => clearTimeout(timer));
}

// 动态引入：本文件保持不依赖 Next 运行时与数据库（API、worker、启动流程共用，
// 单测也能直接加载）；真正写库的 store 才带 server-only 和 prisma。
// 缓存同一个 import Promise，并发的首次落库不会各自触发一次模块加载；加载失败不缓存
let storePromise: Promise<typeof import("@/lib/system-error-store")> | undefined;
function loadStore() {
  storePromise ??= import("@/lib/system-error-store").catch((error) => {
    storePromise = undefined;
    throw error;
  });
  return storePromise;
}

/** 落库一条已整理好的记录：限流、超时、降级都在这里，永不抛错 */
async function persistRecord(record: SystemErrorRecord) {
  if (!takePersistSlot()) {
    return { referenceId: record.referenceId, persisted: false };
  }
  try {
    const { persistSystemErrorRow } = await loadStore();
    await withTimeout(persistSystemErrorRow(record), PERSIST_TIMEOUT_MS);
    return { referenceId: record.referenceId, persisted: true };
  } catch (persistError) {
    console.error(
      "ACHORD_SYSTEM_ERROR_LOG_PERSIST_FAILED",
      JSON.stringify({
        referenceId: record.referenceId,
        error: describeErrorForLog(persistError),
      }),
    );
    return { referenceId: record.referenceId, persisted: false };
  }
}

function buildOrFallback(error: unknown, input: SystemErrorInput) {
  try {
    return { record: buildSystemErrorRecord(error, input) };
  } catch (buildError) {
    // 整理记录本身出错（极端：错误对象的 getter 抛异常）：只留一行降级日志
    const referenceId = input.referenceId ?? newSystemErrorReferenceId();
    console.error(
      "ACHORD_SYSTEM_ERROR_LOG_BUILD_FAILED",
      JSON.stringify({
        referenceId,
        buildError: describeErrorForLog(buildError),
      }),
    );
    return { referenceId };
  }
}

/**
 * 记录一条系统报错：打 console 并落库，等落库结束后返回错误编号与是否成功。
 * 永不抛错：写库失败（含超时、RLS 拒绝、库不可用）只在 console 留一行降级日志。
 */
export async function recordSystemError(
  error: unknown,
  input: SystemErrorInput,
): Promise<{ referenceId: string; persisted: boolean }> {
  const built = buildOrFallback(error, input);
  if (!built.record) return { referenceId: built.referenceId, persisted: false };
  consoleLine(built.record, input);
  return persistRecord(built.record);
}

/**
 * 同步版：先同步打 console（保证日志一定先落到 journalctl），再在后台落库，
 * 立刻返回编号。API 错误响应、worker 失败回调用它，不用等库。
 * pendingActor 是异步解析请求身份的 Promise：必须在请求上下文里同步发起，
 * 这里只负责限时等它，超时或失败就当作身份未知。
 */
export function reportSystemError(
  error: unknown,
  input: SystemErrorInput,
  pendingActor?: Promise<SystemErrorActor | undefined>,
) {
  const built = buildOrFallback(error, input);
  if (!built.record) return built.referenceId;
  const record = built.record;
  consoleLine(record, input);
  void (async () => {
    let finalRecord = record;
    if (pendingActor && !record.actorType) {
      const actor = await withTimeout(pendingActor, ACTOR_LOOKUP_TIMEOUT_MS).catch(
        () => undefined,
      );
      if (actor) {
        finalRecord = {
          ...record,
          actorType: actor.type,
          actorId: actor.id?.slice(0, 128),
        };
      }
    }
    await persistRecord(finalRecord);
  })();
  return record.referenceId;
}
