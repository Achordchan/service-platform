import { describe, expect, it } from "vitest";
import { isProjectDeliveryActive } from "@/components/staff/project-delivery-state";

describe("项目交付状态", () => {
  it("外部接入草稿未激活前隐藏交付能力", () => {
    expect(isProjectDeliveryActive("DRAFT")).toBe(false);
  });

  it.each(["ACTIVE", "PAUSED", "COMPLETED", "EXPIRED"] as const)(
    "%s 项目保留交付历史和管理入口",
    (status) => {
      expect(isProjectDeliveryActive(status)).toBe(true);
    },
  );
});
