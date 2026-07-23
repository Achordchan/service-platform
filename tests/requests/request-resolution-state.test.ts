import { describe, expect, it } from "vitest";
import { shouldShowResolvedReplyGate } from "@/components/customer/request-resolution-state";

describe("客户已解决回复区", () => {
  it("已解决时显示关闭确认蒙层", () => {
    expect(shouldShowResolvedReplyGate("RESOLVED")).toBe(true);
  });

  it.each(["PENDING", "IN_PROGRESS", "WAITING_CUSTOMER", "CLOSED"] as const)(
    "%s 状态正常显示对应回复状态",
    (status) => {
      expect(shouldShowResolvedReplyGate(status)).toBe(false);
    },
  );
});
