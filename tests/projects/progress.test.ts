import { describe, expect, it } from "vitest";
import { calculateProjectProgress } from "../../src/modules/projects/progress";

describe("calculateProjectProgress", () => {
  it("没有里程碑时返回 0%", () => {
    expect(calculateProjectProgress([])).toEqual({
      percentage: 0,
      counts: {
        total: 0,
        notStarted: 0,
        inProgress: 0,
        completed: 0,
      },
    });
  });

  it("按已完成里程碑数量除以总数计算进度", () => {
    expect(
      calculateProjectProgress([
        { status: "NOT_STARTED" },
        { status: "IN_PROGRESS" },
        { status: "COMPLETED" },
      ]),
    ).toEqual({
      percentage: 33,
      counts: {
        total: 3,
        notStarted: 1,
        inProgress: 1,
        completed: 1,
      },
    });
  });

  it("对不能整除的进度四舍五入为整数", () => {
    expect(
      calculateProjectProgress([
        { status: "COMPLETED" },
        { status: "NOT_STARTED" },
        { status: "NOT_STARTED" },
      ]).percentage,
    ).toBe(33);
  });
});
