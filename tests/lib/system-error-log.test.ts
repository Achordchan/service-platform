import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

const store = vi.hoisted(() => ({ persistSystemErrorRow: vi.fn() }));
vi.mock("@/lib/system-error-store", () => store);

import { LoggableError } from "@/lib/error-log";
import {
  buildSystemErrorRecord,
  recordSystemError,
  reportSystemError,
  resetSystemErrorThrottleForTest,
} from "@/lib/system-error-log";

let consoleError: MockInstance<typeof console.error>;

// vitest 对「并发的首次动态 import 一个被 mock 的模块」会让后到的那次绕过 mock；
// 先预热一次，让后面并发的 reportSystemError 都命中缓存里的 mock
beforeAll(async () => {
  await import("@/lib/system-error-store");
});

beforeEach(() => {
  vi.clearAllMocks();
  resetSystemErrorThrottleForTest();
  store.persistSystemErrorRow.mockResolvedValue(undefined);
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
  vi.useRealTimers();
});

describe("系统报错记录的脱敏边界", () => {
  it("邮箱、手机号、密码、令牌不会进入落库内容", () => {
    const error = new Error(
      "smtp failed for ops@example.com password=hunter2 Bearer abcdefghijklmnop 13800138000",
    );
    error.stack = [
      "Error: " + error.message,
      "    at send (/app/src/mail.ts?token=hidden:12:5)",
    ].join("\n");

    const record = buildSystemErrorRecord(error, {
      source: "mail-worker",
      operation: "mail.send",
      request: {
        method: "POST",
        path: "/api/v1/external/ops%40example.com/phone/13800138000?password=hunter2&body=secret-body#frag",
      },
      context: {
        note: "contact ops@example.com token=secret-value",
        nested: { drop: "me" },
        count: 3,
      },
    });
    const serialized = JSON.stringify(record);

    for (const leaked of [
      "ops@example.com",
      "ops%40example.com",
      "hunter2",
      "abcdefghijklmnop",
      "13800138000",
      "secret-value",
      "token=hidden",
      "secret-body",
      "frag",
    ]) {
      expect(serialized).not.toContain(leaked);
    }
    expect(record.context).toEqual({
      note: "contact [EMAIL] token=[REDACTED]",
      count: 3,
    });
  });

  it("只有 LoggableError 的消息会被记录，普通 Error 的消息不记", () => {
    const plain = buildSystemErrorRecord(new Error("来自第三方的原文"), {
      source: "project-api",
    });
    const loggable = buildSystemErrorRecord(new LoggableError("写死的中文报错"), {
      source: "project-api",
    });

    expect(JSON.stringify(plain.details)).not.toContain("来自第三方的原文");
    expect(loggable.details).toMatchObject({ message: "写死的中文报错" });
  });

  it("非法编号回退成随机 err_ 编号，合法的业务编号原样保留", () => {
    const invalid = buildSystemErrorRecord(new Error("x"), {
      source: "s",
      referenceId: "bad id with spaces",
    });
    const business = buildSystemErrorRecord(new Error("x"), {
      source: "s",
      referenceId: "mail_clx123",
    });

    expect(invalid.referenceId).toMatch(/^err_[a-f0-9]{32}$/);
    expect(business.referenceId).toBe("mail_clx123");
  });

  it("来源和操作含非法字符时丢弃，业务标识最多保留 12 项", () => {
    const record = buildSystemErrorRecord(new Error("x"), {
      source: "bad source!",
      operation: "a b",
      context: Object.fromEntries(
        Array.from({ length: 20 }, (_, index) => [`k${index}`, index]),
      ),
    });

    expect(record.source).toBe("unknown");
    expect(record.operation).toBeUndefined();
    expect(Object.keys(record.context ?? {})).toHaveLength(12);
  });
});

describe("落库失败只降级，不影响调用方", () => {
  it("写库抛错时返回 persisted=false，并打一行降级日志", async () => {
    store.persistSystemErrorRow.mockRejectedValue(new Error("db down"));

    const result = await recordSystemError(new Error("boom"), { source: "project-api" });

    expect(result.persisted).toBe(false);
    expect(result.referenceId).toMatch(/^err_/);
    const labels = consoleError.mock.calls.map((call) => call[0]);
    expect(labels).toContain("ACHORD_SYSTEM_ERROR");
    expect(labels).toContain("ACHORD_SYSTEM_ERROR_LOG_PERSIST_FAILED");
  });

  it("写库卡住时按超时放弃，不会一直挂着", async () => {
    vi.useFakeTimers();
    store.persistSystemErrorRow.mockReturnValue(new Promise(() => {}));

    const pending = recordSystemError(new Error("boom"), { source: "project-api" });
    await vi.advanceTimersByTimeAsync(3_100);
    const result = await pending;

    expect(result.persisted).toBe(false);
  });

  it("错误对象的 getter 抛异常也不会让记录函数抛错", async () => {
    const hostile = {
      get name(): string {
        throw new Error("getter exploded");
      },
    };
    Object.setPrototypeOf(hostile, Error.prototype);

    await expect(
      recordSystemError(hostile, { source: "project-api" }),
    ).resolves.toMatchObject({ persisted: false });
    expect(() => reportSystemError(hostile, { source: "project-api" })).not.toThrow();
  });

  it("错误风暴时每分钟只落库有限条数，超出的只进 console", async () => {
    for (let index = 0; index < 125; index += 1) {
      await recordSystemError(new Error("storm"), { source: "worker" });
    }

    expect(store.persistSystemErrorRow).toHaveBeenCalledTimes(120);
    expect(consoleError.mock.calls.filter((call) => call[0] === "ACHORD_SYSTEM_ERROR")).toHaveLength(125);
  });
});

describe("reportSystemError", () => {
  it("同步打印 console 并立刻返回编号，随后在后台落库", async () => {
    const referenceId = reportSystemError(new Error("boom"), {
      referenceId: "err_fixed",
      source: "project-api",
      operation: "x.y",
      logLabel: "MY_LABEL",
      event: "my.event",
    });

    expect(referenceId).toBe("err_fixed");
    expect(consoleError).toHaveBeenCalledOnce();
    expect(consoleError.mock.calls[0][0]).toBe("MY_LABEL");
    expect(JSON.parse(String(consoleError.mock.calls[0][1]))).toMatchObject({
      event: "my.event",
      referenceId: "err_fixed",
      source: "project-api",
      operation: "x.y",
    });
    await vi.waitFor(() =>
      expect(store.persistSystemErrorRow).toHaveBeenCalledOnce(),
    );
  });

  it("解析到操作者身份就写入，解析失败不影响落库", async () => {
    reportSystemError(
      new Error("a"),
      { source: "project-api" },
      Promise.resolve({ type: "STAFF", id: "user-1" }),
    );
    reportSystemError(
      new Error("b"),
      { source: "project-api" },
      Promise.reject(new Error("lookup failed")),
    );

    await vi.waitFor(() =>
      expect(store.persistSystemErrorRow).toHaveBeenCalledTimes(2),
    );
    const records = store.persistSystemErrorRow.mock.calls.map((call) => call[0]);
    expect(records.find((record) => record.actorId === "user-1")).toMatchObject({
      actorType: "STAFF",
    });
    expect(records.some((record) => record.actorType === undefined)).toBe(true);
  });
});
