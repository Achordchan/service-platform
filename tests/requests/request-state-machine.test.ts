import { describe, expect, it } from "vitest";
import {
  assertRequestTransition,
  canTransitionRequest,
  statusAfterCustomerReply,
  statusAfterStaffPublicReply,
} from "../../src/modules/requests/request-state-machine";

describe("服务请求状态机", () => {
  it.each([
    ["PENDING", "IN_PROGRESS"],
    ["PENDING", "WAITING_CUSTOMER"],
    ["IN_PROGRESS", "WAITING_CUSTOMER"],
    ["IN_PROGRESS", "RESOLVED"],
    ["WAITING_CUSTOMER", "IN_PROGRESS"],
    ["WAITING_CUSTOMER", "RESOLVED"],
    ["RESOLVED", "IN_PROGRESS"],
    ["RESOLVED", "CLOSED"],
  ] as const)("允许 %s -> %s", (from, to) => {
    expect(canTransitionRequest(from, to)).toBe(true);
    expect(() => assertRequestTransition(from, to)).not.toThrow();
  });

  it.each([
    ["PENDING", "RESOLVED"],
    ["PENDING", "CLOSED"],
    ["IN_PROGRESS", "CLOSED"],
    ["WAITING_CUSTOMER", "CLOSED"],
    ["CLOSED", "IN_PROGRESS"],
    ["CLOSED", "RESOLVED"],
  ] as const)("拒绝 %s -> %s", (from, to) => {
    expect(canTransitionRequest(from, to)).toBe(false);
    expect(() => assertRequestTransition(from, to)).toThrow(
      "请求状态不能从",
    );
  });

  it("客户回复已解决请求后恢复为处理中", () => {
    expect(statusAfterCustomerReply("RESOLVED")).toBe("IN_PROGRESS");
  });

  it("客户回复待客户响应请求后恢复为处理中", () => {
    expect(statusAfterCustomerReply("WAITING_CUSTOMER")).toBe(
      "IN_PROGRESS",
    );
  });

  it("客户回复其他未关闭状态时不改变状态", () => {
    expect(statusAfterCustomerReply("PENDING")).toBe("PENDING");
    expect(statusAfterCustomerReply("IN_PROGRESS")).toBe("IN_PROGRESS");
  });
});


describe("员工公开回复后的状态", () => {
  it("待处理或处理中自动进入等待客户", () => {
    expect(statusAfterStaffPublicReply("PENDING")).toBe("WAITING_CUSTOMER");
    expect(statusAfterStaffPublicReply("IN_PROGRESS")).toBe("WAITING_CUSTOMER");
  });

  it("已解决、等待客户或关闭不因公开回复改变", () => {
    expect(statusAfterStaffPublicReply("WAITING_CUSTOMER")).toBe(
      "WAITING_CUSTOMER",
    );
    expect(statusAfterStaffPublicReply("RESOLVED")).toBe("RESOLVED");
    expect(statusAfterStaffPublicReply("CLOSED")).toBe("CLOSED");
  });
});
