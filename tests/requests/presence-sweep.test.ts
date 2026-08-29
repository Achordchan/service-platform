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

  it("清理必须绕过 RLS —— 直接 deleteMany 会被静默过滤成 0 行", async () => {
    const { readFile } = await import("node:fs/promises");
    const sweep = await readFile(
      "src/modules/requests/presence-sweep-service.ts",
      "utf8",
    );
    // request_presence_delete 要求 "userId" = app_user_id()，而清理跑在
    // withSystemDb（app.user_id = 'system'）下，匹配不上。
    // 真正「删没删掉」由 request-chat 的集成测试断言，这里只钉住不要改回直接删
    expect(sweep).not.toContain("tx.requestPresence.deleteMany");
    expect(sweep).toContain("app_sweep_expired_request_presence(");

    const migration = await readFile(
      "prisma/migrations/20260829100000_request_presence_sweep_fn/migration.sql",
      "utf8",
    );
    expect(migration).toContain("SECURITY DEFINER");
    // cutoff 被夹住：调用方只能清已过保留期的，传未来时间也删不掉在线记录
    expect(migration).toContain("LEAST(");
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION app_sweep_expired_request_presence",
    );
    // 两张表都要清，否则有一半永久堆着
    expect(migration).toContain('DELETE FROM "RequestPresence"');
    expect(migration).toContain('DELETE FROM "ExternalRequestPresence"');

    const jobs = await readFile("src/lib/jobs.ts", "utf8");
    expect(jobs).toContain("REQUEST_PRESENCE_SWEEP_JOB");
    expect(jobs).toContain("boss.createQueue(REQUEST_PRESENCE_SWEEP_JOB)");
    expect(jobs).toContain("boss.schedule(REQUEST_PRESENCE_SWEEP_JOB");
    expect(jobs).toContain("cleanupExpiredRequestPresence()");
  });
});
