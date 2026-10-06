import { describe, expect, it, vi } from "vitest";

// 落库有专门的集成测试；这里只验证 console 输出与响应
vi.mock("@/lib/system-error-store", () => ({
  persistSystemErrorRow: vi.fn(async () => {}),
}));
import { unexpectedApiErrorResponse } from "@/lib/api-error";
import { LoggableError } from "@/lib/error-log";

function logFor(error: unknown, request?: Request) {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  unexpectedApiErrorResponse(error, { source: "project-api", request });
  const logged = String(consoleError.mock.calls[0]?.[1]);
  consoleError.mockRestore();
  return { logged, record: JSON.parse(logged) };
}

function driverAdapterError(cause: Record<string, unknown>) {
  const error = new Error(String(cause.message ?? cause.kind));
  error.name = "DriverAdapterError";
  (error as Error & { cause: unknown }).cause = cause;
  return error;
}

describe("API 意外错误响应", () => {
  it("返回可关联编号，并只写入脱敏的诊断字段", async () => {
    const error = new Error(
      "Unknown argument `emailEligible`. password=not-for-logs",
    );
    error.name = "PrismaClientValidationError";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = unexpectedApiErrorResponse(error, {
      source: "project-api",
      operation: "project_update.create",
      request: new Request("https://support.achord.cn/api/v1/projects/a/updates?token=hidden", {
        method: "POST",
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get("X-Achord-Error-Id")).toMatch(/^err_[a-f0-9]{32}$/);
    expect(payload).toMatchObject({
      error: {
        code: "INTERNAL_ERROR",
        referenceId: response.headers.get("X-Achord-Error-Id"),
      },
    });
    expect(payload.error.message).toContain(payload.error.referenceId);
    expect(consoleError).toHaveBeenCalledOnce();
    const logged = String(consoleError.mock.calls[0]?.[1]);
    expect(logged).toContain('"unknownArgument":"emailEligible"');
    expect(logged).toContain('"category":"DATABASE_SCHEMA"');
    expect(logged).toContain('"path":"/api/v1/projects/a/updates"');
    expect(logged).not.toContain("not-for-logs");
    expect(logged).not.toContain("token=hidden");
    consoleError.mockRestore();
  });

  it("堆栈帧只保留标准格式，并去掉位置里的查询串", () => {
    const error = new Error("failure");
    error.stack = [
      "Error: failure",
      "    at handler (authorization=Bearer-secret)",
      "    at async POST (/app/.next/server/chunk.js?token=hidden:a:10:5)",
      "    at new Foo (/app/src/foo.ts:3:7)",
      "    at node:internal/process/task_queues:95:5",
    ].join("\n");

    const { logged, record } = logFor(
      error,
      new Request("https://support.achord.cn/api/v1/requests/token=hidden"),
    );

    expect(record.error.stackFrames).toEqual([
      "at async POST (/app/.next/server/chunk.js:10:5)",
      "at new Foo (/app/src/foo.ts:3:7)",
      "at node:internal/process/task_queues:95:5",
    ]);
    expect(logged).not.toContain("Bearer-secret");
    expect(logged).not.toContain("token=hidden");
  });

  it("记录 RLS 拒绝的 SQLSTATE、表名和类别，不记 DETAIL / HINT", () => {
    const { logged, record } = logFor(
      driverAdapterError({
        kind: "postgres",
        originalCode: "42501",
        originalMessage:
          'new row violates row-level security policy for table "Notification"',
        code: "42501",
        severity: "ERROR",
        message:
          'new row violates row-level security policy for table "Notification"',
        detail: "Failing row contains (row-secret-value, user@example.com).",
        hint: "check row-secret-hint",
      }),
    );
    expect(record.error).toMatchObject({
      name: "DriverAdapterError",
      category: "DATABASE_PERMISSION",
      database: {
        kind: "postgres",
        sqlState: "42501",
        message:
          'new row violates row-level security policy for table "Notification"',
      },
    });
    expect(record.error.message).toBeUndefined();
    for (const secret of ["row-secret-value", "user@example.com", "row-secret-hint"]) {
      expect(logged).not.toContain(secret);
    }
  });

  it("识别 Prisma 包装过的 driver adapter 错误，但不记 Prisma 回显参数的消息", () => {
    const error = new Error(
      'Invalid `tx.user.create()` invocation: { email: "leak@example.com" } Unique constraint failed',
    );
    error.name = "PrismaClientKnownRequestError";
    Object.assign(error, {
      code: "P2002",
      meta: {
        modelName: "User",
        driverAdapterError: driverAdapterError({
          kind: "UniqueConstraintViolation",
          originalCode: "23505",
          originalMessage:
            'duplicate key value violates unique constraint "User_email_key"',
          constraint: { fields: ["email"] },
        }),
      },
    });
    const { logged, record } = logFor(error);
    expect(record.error).toMatchObject({
      category: "DATABASE_CONSTRAINT",
      code: "P2002",
      model: "User",
      database: {
        kind: "UniqueConstraintViolation",
        sqlState: "23505",
        message: 'duplicate key value violates unique constraint "User_email_key"',
        constraintFields: ["email"],
      },
    });
    expect(record.error.message).toBeUndefined();
    expect(logged).not.toContain("leak@example.com");
  });

  it.each([
    'null value in column "title" of relation "ServiceRequest" violates not-null constraint',
    'insert or update on table "RequestMessage" violates foreign key constraint "RequestMessage_serviceRequestId_fkey"',
    'relation "public.Foo" does not exist',
    "function app_insert_request_notification(text, timestamp without time zone) does not exist",
    "request notification scope denied",
  ])("命中模板的数据库报错原文照常记录：%s", (message) => {
    const { record } = logFor(
      driverAdapterError({ kind: "postgres", originalMessage: message, message }),
    );
    expect(record.error.database.message).toBe(message);
  });

  it("数据库函数抛出的小写短语不在固定清单里就不记（可能是外部传入的口令）", () => {
    const { logged, record } = logFor(
      driverAdapterError({
        kind: "postgres",
        originalCode: "P0001",
        originalMessage: "correct horse battery staple",
        message: "correct horse battery staple",
      }),
    );
    expect(record.error.database).toEqual({ kind: "postgres", sqlState: "P0001" });
    expect(logged).not.toContain("horse");
  });

  it("不在模板里的数据库报错只记 SQLSTATE 和类别，不记原文", () => {
    const { logged, record } = logFor(
      driverAdapterError({
        kind: "InvalidInputValue",
        originalCode: "22P02",
        originalMessage: 'invalid input syntax for type uuid: "zhangsan"',
        message: 'invalid input syntax for type uuid: "zhangsan"',
      }),
    );
    expect(record.error.database).toEqual({
      kind: "InvalidInputValue",
      sqlState: "22P02",
    });
    expect(logged).not.toContain("zhangsan");
  });

  it("显式的 LoggableError 记录原文，cause 里的第三方原文不记", () => {
    const root = new Error(
      "provider rejected token=abc123 for bob@example.com at https://api.example.test/v1/send?key=zzz",
    );
    const error = new LoggableError("请求通知写入失败", { cause: root });
    const { logged, record } = logFor(error);
    expect(record.error.message).toBe("请求通知写入失败");
    expect(record.error.causes).toEqual([{ name: "Error" }]);
    for (const secret of ["abc123", "bob@example.com", "key=zzz", "provider rejected"]) {
      expect(logged).not.toContain(secret);
    }
  });

  it("cause 里的数据库错误同样记下诊断", () => {
    const error = new LoggableError("风控通知暂缓失败", {
      cause: driverAdapterError({
        kind: "postgres",
        originalCode: "42501",
        originalMessage:
          'new row violates row-level security policy for table "Notification"',
      }),
    });
    const { record } = logFor(error);
    expect(record.error.causes).toEqual([
      {
        name: "DriverAdapterError",
        database: {
          kind: "postgres",
          sqlState: "42501",
          message:
            'new row violates row-level security policy for table "Notification"',
        },
      },
    ]);
  });

  it.each([
    ["认证头", "Request rejected: Authorization: Bearer abcdefghijklmnop", "abcdefghijklmnop"],
    ["连接串", "Connection failed: postgres://app:p@ssw0rd@localhost:5432/app", "ssw0rd"],
    ["嵌套 JSON", 'payload {"body":"{\\"password\\":\\"hunterTwo\\"}"}', "hunterTwo"],
    ["空格隔开的键值", "authentication failed: password = hunterTwo", "hunterTwo"],
    ["多词口令", "password=correct horse battery staple", "horse"],
    ["纯符号口令", "authentication failed: pwd -> !@#$%^&*", "!@#$%^&*"],
    ["多个 Cookie", "Cookie: sid=firstCredential; auth=secondCredential", "secondCredential"],
    ["夹带字母数字的中文", "密码： hunter2 错误", "hunter2"],
    ["拼接了外部值的中文", "资料字段 plan_secret 为系统保留字段", "plan_secret"],
    ["普通英文", "upstream said no for customer Alice", "Alice"],
    ["纯中文的凭据", "密码：春风十里", "春风十里"],
    ["纯中文的普通 Error", "请求通知写入失败", "请求通知写入失败"],
  ])("第三方或拼接了外部值的错误原文一律不记：%s", (_label, message, secret) => {
    const { logged, record } = logFor(new Error(message));
    expect(record.error.message).toBeUndefined();
    expect(logged).not.toContain(secret);
  });

  it("多行消息不会经由 stack 里重复的消息行漏进堆栈帧", () => {
    const { logged, record } = logFor(
      new Error("first line\nsecond line has tok_9f8e7d6c5b4a"),
    );
    expect(logged).not.toContain("tok_9f8e7d6c5b4a");
    expect(record.error.stackFrames.length).toBeGreaterThan(0);
    for (const frame of record.error.stackFrames) expect(frame).toMatch(/^at\s/);
  });

  it("多行消息里像堆栈帧的行（在第四行之后）也不会被记下", () => {
    const message = [
      "provider failed",
      "line two",
      "line three",
      "line four",
      "at https://provider.example/request?key=plainSecret",
      "at leak (https://provider.example/r?key=plainSecret:1:2)",
    ].join("\n");
    const { logged, record } = logFor(new Error(message));
    expect(logged).not.toContain("plainSecret");
    expect(logged).not.toContain("provider.example");
    expect(record.error.stackFrames.length).toBeGreaterThan(0);
  });

  it("消息在 stack 里找不到时不记堆栈帧", () => {
    const error = new Error("original");
    error.message = "changed later";
    error.stack = "Error: something else\n    at leak (/app/secret-path.ts:1:2)";
    const { record } = logFor(error);
    expect(record.error.stackFrames).toEqual([]);
  });

  it("请求路径里 URL 编码的邮箱会解码后打码", () => {
    const { record } = logFor(
      new Error("boom"),
      new Request(
        "https://support.achord.cn/api/v1/integrations/universal/contacts/alice%40example.com/unread",
      ),
    );
    expect(record.request.path).toBe(
      "/api/v1/integrations/universal/contacts/[EMAIL]/unread",
    );
  });
});
