import type { PgBoss } from "pg-boss";
import { reportSystemError } from "@/lib/system-error-log";

type Handler = (...args: unknown[]) => Promise<unknown>;

const instrumented = new WeakSet<object>();

/**
 * pg-boss 任务处理函数抛错只会让任务进入重试/失败状态，不会留下任何日志。
 * 把 boss.work 包一层：先记录到系统报错日志，再原样抛出，不改变重试语义。
 * 对同一个 boss 只生效一次。
 */
export function instrumentBossJobFailures(boss: Pick<PgBoss, "work">) {
  if (instrumented.has(boss)) return;
  instrumented.add(boss);
  const originalWork = boss.work.bind(boss) as unknown as (
    name: string,
    ...rest: unknown[]
  ) => Promise<string>;
  const wrap = (queue: string, handler: Handler): Handler => async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      reportSystemError(error, {
        source: "worker",
        operation: `job.${queue}`,
        context: { queue },
        logLabel: "ACHORD_JOB_FAILED",
        event: "job.failed",
      });
      throw error;
    }
  };
  boss.work = ((name: string, ...rest: unknown[]) => {
    // work(name, handler) 与 work(name, options, handler) 两种重载，处理函数永远是最后一个参数
    const handlerIndex = rest.length - 1;
    const handler = rest[handlerIndex];
    if (typeof handler === "function") {
      rest[handlerIndex] = wrap(name, handler as Handler);
    }
    return originalWork(name, ...rest);
  }) as unknown as PgBoss["work"];
}
