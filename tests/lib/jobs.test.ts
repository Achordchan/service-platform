import { describe, expect, it, vi } from "vitest";

const bossMocks = vi.hoisted(() => ({
  createQueue: vi.fn(),
  start: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("pg-boss", () => ({
  PgBoss: class {
    start = bossMocks.start;
    createQueue = bossMocks.createQueue;
  },
}));

vi.mock("@/lib/runtime-env", () => ({
  env: {
    DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/test",
    JOB_DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/test",
    MAIL_INLINE_WORKER: false,
  },
}));

describe("任务队列连接", () => {
  it("首次连接失败后会清除失败缓存，使后续入队能够重新连接", async () => {
    bossMocks.start.mockRejectedValueOnce(new Error("queue unavailable"));
    bossMocks.start.mockResolvedValueOnce(undefined);
    bossMocks.createQueue.mockResolvedValue(undefined);

    const { getBoss } = await import("@/lib/jobs");

    await expect(getBoss()).rejects.toThrow("queue unavailable");
    await expect(getBoss()).resolves.toBeDefined();
    expect(bossMocks.start).toHaveBeenCalledTimes(2);
  });
});
