import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("在线记录的保留期清理", () => {
  it("离线只标记不删行，两条路径都是（否则设备信息一关页面就没了）", async () => {
    const { readFile } = await import("node:fs/promises");
    const internal = await readFile(
      "src/modules/requests/request-presence-service.ts",
      "utf8",
    );
    const external = await readFile(
      "src/modules/integrations/external/presence-service.ts",
      "utf8",
    );
    for (const source of [internal, external]) {
      const leave = source
        .slice(source.indexOf('input.action === "leave"'))
        .slice(0, 900);
      expect(leave).toContain("updateMany");
      expect(leave).toContain("expiresAt: now");
      // 旧写法：deleteMany 会把设备记录一起抹掉
      expect(leave.slice(0, leave.indexOf("}"))).not.toContain("deleteMany");
    }
  });

  it("外部联系人那条的顺带清理必须按保留期，不能按 expiresAt <= now", async () => {
    const { readFile } = await import("node:fs/promises");
    const external = await readFile(
      "src/modules/integrations/external/presence-service.ts",
      "utf8",
    );
    // 离开时是标成已过期而不是删除，按 <= now 清就等于没保留
    expect(external).not.toContain("expiresAt: { lte: now }");
    expect(external).toContain("PRESENCE_RETENTION_MS");
  });

  it("有全局定时清理兜底 —— 顺带清理只覆盖当前工单，靠不住", async () => {
    const { readFile } = await import("node:fs/promises");
    const sweep = await readFile(
      "src/modules/requests/presence-sweep-service.ts",
      "utf8",
    );
    // 两张表都要清，否则外部联系人的 IP/UA 会永久堆着
    expect(sweep).toContain("tx.requestPresence.deleteMany");
    expect(sweep).toContain("tx.externalRequestPresence.deleteMany");

    const jobs = await readFile("src/lib/jobs.ts", "utf8");
    expect(jobs).toContain("REQUEST_PRESENCE_SWEEP_JOB");
    expect(jobs).toContain("boss.createQueue(REQUEST_PRESENCE_SWEEP_JOB)");
    expect(jobs).toContain("boss.schedule(REQUEST_PRESENCE_SWEEP_JOB");
    expect(jobs).toContain("cleanupExpiredRequestPresence()");
  });
});
