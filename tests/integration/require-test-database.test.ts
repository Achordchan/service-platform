import { afterEach, describe, expect, it } from "vitest";
import { assertIntegrationTestDatabase } from "./require-test-database";

const original = {
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_MIGRATION_URL: process.env.DATABASE_MIGRATION_URL,
  JOB_DATABASE_URL: process.env.JOB_DATABASE_URL,
};

function setEnv(values: {
  DATABASE_URL?: string;
  DATABASE_MIGRATION_URL?: string;
  JOB_DATABASE_URL?: string | null;
}) {
  for (const key of [
    "DATABASE_URL",
    "DATABASE_MIGRATION_URL",
    "JOB_DATABASE_URL",
  ] as const) {
    const value = values[key];
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

afterEach(() => {
  setEnv({
    DATABASE_URL: original.DATABASE_URL,
    DATABASE_MIGRATION_URL: original.DATABASE_MIGRATION_URL,
    JOB_DATABASE_URL: original.JOB_DATABASE_URL ?? null,
  });
});

describe("集成测试数据库门禁", () => {
  it("拒绝主库 service_platform", () => {
    setEnv({
      DATABASE_URL:
        "postgresql://app@localhost:5438/service_platform?schema=public",
      DATABASE_MIGRATION_URL:
        "postgresql://owner@localhost:5438/service_platform?schema=public",
      JOB_DATABASE_URL: null,
    });
    expect(() => assertIntegrationTestDatabase()).toThrow(/拒绝连接非测试数据库/);
  });

  it("接受 service_platform_test 同一实例", () => {
    setEnv({
      DATABASE_URL:
        "postgresql://app@localhost:5438/service_platform_test?schema=public",
      DATABASE_MIGRATION_URL:
        "postgresql://owner@localhost:5438/service_platform_test?schema=public",
      JOB_DATABASE_URL:
        "postgresql://jobs@localhost:5438/service_platform_test",
    });
    expect(() => assertIntegrationTestDatabase()).not.toThrow();
  });

  it("拒绝库名相同但主机不同", () => {
    setEnv({
      DATABASE_URL:
        "postgresql://app@localhost:5438/service_platform_test?schema=public",
      DATABASE_MIGRATION_URL:
        "postgresql://owner@db.internal:5438/service_platform_test?schema=public",
      JOB_DATABASE_URL:
        "postgresql://jobs@localhost:5438/service_platform_test",
    });
    expect(() => assertIntegrationTestDatabase()).toThrow(/同一测试库实例/);
  });

  it("拒绝库名相同但端口不同", () => {
    setEnv({
      DATABASE_URL:
        "postgresql://app@localhost:5438/service_platform_test?schema=public",
      DATABASE_MIGRATION_URL:
        "postgresql://owner@localhost:5439/service_platform_test?schema=public",
      JOB_DATABASE_URL: null,
    });
    expect(() => assertIntegrationTestDatabase()).toThrow(/同一测试库实例/);
  });

  it("拒绝库名不同", () => {
    setEnv({
      DATABASE_URL:
        "postgresql://app@localhost:5438/service_platform_test?schema=public",
      DATABASE_MIGRATION_URL:
        "postgresql://owner@localhost:5438/other_test?schema=public",
      JOB_DATABASE_URL: null,
    });
    expect(() => assertIntegrationTestDatabase()).toThrow(/同一测试库实例/);
  });
});
