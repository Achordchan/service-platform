import { describe, expect, it } from "vitest";
import { resolveUniversalActionUrl } from "@/modules/integrations/external/action-url";

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
});
