import { describe, expect, it } from "vitest";
import { createServiceTypeSchema } from "@/modules/projects/schemas";
import { calculateRequestDueAt } from "@/modules/requests/request-sla";

describe("服务请求 SLA", () => {
  it("按服务类型解决时限计算截止时间", () => {
    const createdAt = new Date("2026-08-14T08:00:00.000Z");

    expect(calculateRequestDueAt(90, createdAt)).toEqual(
      new Date("2026-08-14T09:30:00.000Z"),
    );
  });

  it("没有有效解决时限时不生成截止时间", () => {
    const createdAt = new Date("2026-08-14T08:00:00.000Z");

    expect(calculateRequestDueAt(null, createdAt)).toBeNull();
    expect(calculateRequestDueAt(0, createdAt)).toBeNull();
    expect(calculateRequestDueAt(1.5, createdAt)).toBeNull();
  });

  it("服务类型 API 接受有效 SLA 分钟并允许清空", () => {
    expect(
      createServiceTypeSchema.parse({
        key: "sla-support",
        name: "SLA 支持",
        slaResponseMinutes: 30,
        slaResolutionMinutes: 480,
      }),
    ).toMatchObject({
      slaResponseMinutes: 30,
      slaResolutionMinutes: 480,
    });
    expect(
      createServiceTypeSchema.parse({
        key: "sla-clear",
        name: "清空 SLA",
        slaResponseMinutes: null,
        slaResolutionMinutes: null,
      }),
    ).toMatchObject({
      slaResponseMinutes: null,
      slaResolutionMinutes: null,
    });
  });
});
