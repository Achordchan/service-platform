import { describe, expect, it, vi } from "vitest";
import { unexpectedApiErrorResponse } from "@/lib/api-error";

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

  it("会脱敏堆栈和路径中的敏感片段", () => {
    const error = new Error("failure");
    error.stack = [
      "Error: failure",
      "at handler (authorization=Bearer-secret)",
    ].join("\n");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    unexpectedApiErrorResponse(error, {
      source: "request-api",
      request: new Request(
        "https://support.achord.cn/api/v1/requests/token=hidden",
      ),
    });

    const logged = String(consoleError.mock.calls[0]?.[1]);
    expect(logged).toContain("[REDACTED]");
    expect(logged).not.toContain("Bearer-secret");
    expect(logged).not.toContain("token=hidden");
    consoleError.mockRestore();
  });

  function logFor(error: unknown) {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    unexpectedApiErrorResponse(error, { source: "project-api" });
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

  it("记录 RLS 拒绝的 SQLSTATE、表名和类别，不记 DETAIL 里的行数据", () => {
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
    expect(logged).not.toContain("row-secret-value");
    expect(logged).not.toContain("user@example.com");
  });

  it("识别 Prisma 包装过的 driver adapter 错误，但不记 Prisma 回显参数的消息", () => {
    const error = new Error(
      "Invalid `tx.user.create()` invocation: { email: \"leak@example.com\" } Unique constraint failed",
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

  it("只保留关键词后的 SQL 标识符，回显的输入值即使像标识符也打码", () => {
    const { logged, record } = logFor(
      driverAdapterError({
        kind: "InvalidInputValue",
        originalCode: "22P02",
        originalMessage: 'invalid input syntax for type uuid: "zhangsan"',
        message: 'invalid input syntax for type uuid: "zhangsan"',
      }),
    );
    expect(record.error.database.message).toBe(
      'invalid input syntax for type uuid: "[REDACTED]"',
    );
    expect(logged).not.toContain("zhangsan");
  });

  it("普通错误记录脱敏后的消息和 cause 链", () => {
    const root = new Error(
      "provider rejected token=abc123 for bob@example.com at https://api.example.test/v1/send?key=zzz phone 13800138000 value 'secret input'",
    );
    const error = new Error("请求通知写入失败", { cause: root });
    const { logged, record } = logFor(error);
    expect(record.error.message).toBe("请求通知写入失败");
    expect(record.error.causes).toEqual([
      {
        name: "Error",
        message:
          "provider rejected token=[REDACTED] for [EMAIL] at https://api.example.test/v1/send?[REDACTED] phone [NUMBER] value '[REDACTED]'",
      },
    ]);
    for (const secret of ["abc123", "bob@example.com", "key=zzz", "13800138000", "secret input"]) {
      expect(logged).not.toContain(secret);
    }
  });

  it.each([
    ["Bearer 认证头", "Request rejected: Authorization: Bearer abcdefghijklmnop", "abcdefghijklmnop"],
    ["Basic 认证头", "Request rejected: Authorization: Basic dXNlcjpwYXNzd29yZA==", "dXNlcjpwYXNzd29yZA=="],
    ["带引号的认证头", 'headers {"authorization":"Embed sess-123456789"}', "sess-123456789"],
    ["裸的 Bearer 令牌", "upstream said Bearer zzzyyyxxx rejected", "zzzyyyxxx"],
    ["PostgreSQL 连接串", "Connection failed: postgres://app:s3cr3t@localhost:5432/app", "s3cr3t"],
    ["Redis 连接串", "redis://default:hunter2@cache.internal:6379/0 refused", "hunter2"],
    ["HTTP URL 账号密码", "fetch https://svc:pa55word@api.example.test/v1?x=1 failed", "pa55word"],
    ["带前缀的密钥键", "config client_secret=cs_live_9f8e7d invalid", "cs_live_9f8e7d"],
    ["JSON 里的密码", 'payload {"password":"p@ss w0rd","user":"x"}', "p@ss w0rd"],
    ["Cookie", "cookie: sid=abc123def; path=/", "abc123def"],
  ])("消息里的凭据会被整段打码：%s", (_label, message, secret) => {
    const { logged } = logFor(new Error(message));
    expect(logged).not.toContain(secret);
    expect(logged).toContain("[REDACTED]");
  });

  it("跨行和落单的引号里的回显值也会打码", () => {
    const multiline = logFor(
      driverAdapterError({
        kind: "InvalidInputValue",
        originalCode: "22P02",
        originalMessage: 'invalid input syntax for type uuid: "alice\nsmith"',
      }),
    );
    expect(multiline.record.error.database.message).toBe(
      'invalid input syntax for type uuid: "[REDACTED]"',
    );
    expect(multiline.logged).not.toContain("alice");

    const dangling = logFor(new Error('value too long: "partial user inp'));
    expect(dangling.record.error.message).toBe('value too long: "[REDACTED]');
  });

  it("URL 去掉账号密码后仍保留主机和路径便于排查", () => {
    const { record } = logFor(
      new Error("Connection failed: postgres://app:s3cr3t@db.internal:5432/app"),
    );
    expect(record.error.message).toBe(
      "Connection failed: postgres://[REDACTED]@db.internal:5432/app",
    );
  });

  it.each([
    ["多个 Cookie", "upstream 401 Cookie: sid=firstCredential; auth=secondCredential", ["firstCredential", "secondCredential"]],
    ["Set-Cookie", "set-cookie: sess=aaa111; HttpOnly, remember=bbb222", ["aaa111", "bbb222"]],
    ["JSON 敏感字段后的普通字段", 'payload {"token":"abc123","value":"private note"}', ["abc123", "private note"]],
    ["JSON 认证头后的普通字段", '{"authorization":"Bearer tok999999","memo":"call me later"}', ["tok999999", "call me later"]],
    ["单引号 JSON", "{'password': 'p1', 'note': 'secret diary'}", ["p1'", "secret diary"]],
  ])("凭据替换不会打乱引号，其后的私人字段同样打码：%s", (_label, message, secrets) => {
    const { logged } = logFor(new Error(message));
    for (const secret of secrets) expect(logged).not.toContain(secret);
  });

  it("保留 JSON 键名和撇号前后的表名，便于定位", () => {
    const json = logFor(new Error('payload {"token":"abc123","value":"private note"}'));
    expect(json.record.error.message).toBe(
      'payload {"token":"[REDACTED]","value":"[REDACTED]"}',
    );
    const apostrophe = logFor(
      new Error(`can't insert: new row violates row-level security policy for table "Notification", isn't allowed`),
    );
    expect(apostrophe.record.error.message).toContain('table "Notification"');
  });

  it.each([
    ["JWT", "invalid jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlLXZhbHVl rejected", "eyJhbGciOiJIUzI1NiJ9"],
    ["服务商密钥", "provider refused sk-proj-abcdefghijklmnop1234", "abcdefghijklmnop1234"],
    ["GitHub 令牌", "push failed with ghp_1234567890abcdefghijklmn", "ghp_1234567890abcdefghijklmn"],
    ["分组手机号", "contact 138-0013-8000 or +86 138 0013 8000", "0013"],
  ])("没有键名的令牌和号码也会打码：%s", (_label, message, secret) => {
    const { logged } = logFor(new Error(message));
    expect(logged).not.toContain(secret);
  });

  it("请求路径里 URL 编码的邮箱会解码后打码", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    unexpectedApiErrorResponse(new Error("boom"), {
      source: "universal-api",
      request: new Request(
        "https://support.achord.cn/api/v1/integrations/universal/contacts/alice%40example.com/unread",
      ),
    });
    const record = JSON.parse(String(consoleError.mock.calls[0]?.[1]));
    consoleError.mockRestore();
    expect(record.request.path).toBe(
      "/api/v1/integrations/universal/contacts/[EMAIL]/unread",
    );
  });
});
