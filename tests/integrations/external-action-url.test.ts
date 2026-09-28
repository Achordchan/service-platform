import { describe, expect, it } from "vitest";
import {
  resolveUniversalActionUrl,
  resolveUniversalMailAction,
  UNIVERSAL_IN_APP_MAIL_NOTICE,
} from "@/modules/integrations/external/action-url";

describe("universal external action URL", () => {
  it("uses the contact's most recent allowed parent Origin", () => {
    expect(
      resolveUniversalActionUrl("https://b.example.test", [
        "https://a.example.test",
        "https://b.example.test",
      ]),
    ).toBe("https://b.example.test");
  });

  it("does not guess between multiple Origins without a valid contact Origin", () => {
    expect(
      resolveUniversalActionUrl(null, [
        "https://a.example.test",
        "https://b.example.test",
      ]),
    ).toBeNull();
    expect(
      resolveUniversalActionUrl("https://stale.example.test", [
        "https://a.example.test",
        "https://b.example.test",
      ]),
    ).toBeNull();
  });

  it("uses the only configured Origin when no visit has been recorded", () => {
    expect(resolveUniversalActionUrl(null, ["https://app.example.test"])).toBe(
      "https://app.example.test",
    );
  });

  describe("邮件引导", () => {
    it("只用过 Native Launch 且连接没有 Origin 时不放链接，改为应用内提示", () => {
      expect(resolveUniversalMailAction(null, [])).toEqual({
        actionUrl: null,
        actionNotice: UNIVERSAL_IN_APP_MAIL_NOTICE,
      });
      expect(
        resolveUniversalMailAction(null, [
          "https://a.example.test",
          "https://b.example.test",
        ]),
      ).toEqual({ actionUrl: null, actionNotice: UNIVERSAL_IN_APP_MAIL_NOTICE });
    });

    it("有可信来源时照旧放返回链接", () => {
      expect(
        resolveUniversalMailAction("https://b.example.test", [
          "https://a.example.test",
          "https://b.example.test",
        ]),
      ).toEqual({ actionUrl: "https://b.example.test", actionNotice: null });
      expect(resolveUniversalMailAction(null, ["https://app.example.test"])).toEqual({
        actionUrl: "https://app.example.test",
        actionNotice: null,
      });
    });

    it("iframe 来源已失效时不猜站点，保持不发", () => {
      expect(
        resolveUniversalMailAction("https://stale.example.test", [
          "https://a.example.test",
          "https://b.example.test",
        ]),
      ).toBeNull();
    });
  });
});
