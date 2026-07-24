import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/system-db", () => ({
  withSystemDb: (callback: (tx: unknown) => unknown) =>
    callback({ user: { findUnique: databaseMocks.findUnique } }),
}));

import { hasActiveLoginAccount } from "@/modules/users/login-account-service";

beforeEach(() => {
  databaseMocks.findUnique.mockReset();
});

describe("登录邮箱账号校验", () => {
  it("有效账号允许发送验证码", async () => {
    databaseMocks.findUnique.mockResolvedValue({
      deletedAt: null,
      emailVerified: true,
    });

    await expect(hasActiveLoginAccount(" User@Example.com ")).resolves.toBe(
      true,
    );
    expect(databaseMocks.findUnique).toHaveBeenCalledWith({
      where: { email: "user@example.com" },
      select: { deletedAt: true, emailVerified: true },
    });
  });

  it("不存在、未完成邀请或已删除账号均不可发送验证码", async () => {
    databaseMocks.findUnique.mockResolvedValueOnce(null);
    await expect(hasActiveLoginAccount("missing@example.com")).resolves.toBe(
      false,
    );

    databaseMocks.findUnique.mockResolvedValueOnce({
      deletedAt: null,
      emailVerified: false,
    });
    await expect(hasActiveLoginAccount("pending@example.com")).resolves.toBe(
      false,
    );

    databaseMocks.findUnique.mockResolvedValueOnce({
      deletedAt: new Date(),
      emailVerified: true,
    });
    await expect(hasActiveLoginAccount("deleted@example.com")).resolves.toBe(
      false,
    );
  });
});
