import { beforeEach, describe, expect, it, vi } from "vitest";

const reporter = vi.hoisted(() => ({ reportSystemError: vi.fn() }));
vi.mock("@/lib/system-error-log", () => reporter);

import { instrumentBossJobFailures } from "@/lib/job-failure-log";

function fakeBoss() {
  const registered: Array<{ name: string; handler: (...args: unknown[]) => Promise<unknown> }> = [];
  return {
    registered,
    work: vi.fn(async (name: string, ...rest: unknown[]) => {
      registered.push({
        name,
        handler: rest[rest.length - 1] as (...args: unknown[]) => Promise<unknown>,
      });
      return "worker-id";
    }),
  };
}

describe("任务失败日志", () => {
  beforeEach(() => vi.clearAllMocks());

  it("任务抛错时记录并原样抛出，保持 pg-boss 的重试语义", async () => {
    const boss = fakeBoss();
    const failure = new Error("job exploded");
    instrumentBossJobFailures(boss as never);

    await (boss.work as unknown as (...args: unknown[]) => Promise<string>)(
      "send-email",
      { batchSize: 1 },
      async () => {
        throw failure;
      },
    );

    await expect(boss.registered[0].handler([])).rejects.toBe(failure);
    expect(reporter.reportSystemError).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({
        source: "worker",
        operation: "job.send-email",
        context: { queue: "send-email" },
      }),
    );
  });

  it("成功的任务不记录，并透传返回值和参数；两参数重载也能包装", async () => {
    const boss = fakeBoss();
    instrumentBossJobFailures(boss as never);

    await (boss.work as unknown as (...args: unknown[]) => Promise<string>)(
      "queue-a",
      async (jobs: unknown) => jobs,
    );

    await expect(boss.registered[0].handler(["job"])).resolves.toEqual(["job"]);
    expect(reporter.reportSystemError).not.toHaveBeenCalled();
  });

  it("同一个 boss 重复包装不会叠加记录", async () => {
    const boss = fakeBoss();
    instrumentBossJobFailures(boss as never);
    instrumentBossJobFailures(boss as never);

    await (boss.work as unknown as (...args: unknown[]) => Promise<string>)(
      "queue-a",
      {},
      async () => {
        throw new Error("x");
      },
    );
    await boss.registered[0].handler([]).catch(() => undefined);

    expect(reporter.reportSystemError).toHaveBeenCalledTimes(1);
  });
});
