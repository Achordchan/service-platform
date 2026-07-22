import { describe, expect, it } from "vitest";
import { SMTP_PROVIDER_GUIDES } from "@/components/staff/smtp-provider-guides";

describe("SMTP 接入教程", () => {
  it("服务商标识唯一且预设不包含凭据", () => {
    expect(new Set(SMTP_PROVIDER_GUIDES.map((guide) => guide.key)).size).toBe(
      SMTP_PROVIDER_GUIDES.length,
    );
    for (const guide of SMTP_PROVIDER_GUIDES) {
      expect(guide.port).toBeGreaterThan(0);
      expect(guide.port).toBeLessThanOrEqual(65535);
      expect(guide).not.toHaveProperty("password");
      expect(guide).not.toHaveProperty("token");
    }
  });
});
