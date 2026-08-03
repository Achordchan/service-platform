import { describe, expect, it } from "vitest";
import {
  formatDateString,
  parseDateString,
} from "@/components/shared/date-string-picker";

describe("date string picker adapter", () => {
  it("round-trips valid date-only values without timezone drift", () => {
    const parsed = parseDateString("2026-07-31");

    expect(parsed).not.toBeNull();
    expect(formatDateString(parsed)).toBe("2026-07-31");
  });

  it("rejects incomplete or impossible calendar dates", () => {
    expect(parseDateString("2026-7-31")).toBeNull();
    expect(parseDateString("2026-02-31")).toBeNull();
    expect(parseDateString("")).toBeNull();
  });

  it("maps empty picker values back to an empty form value", () => {
    expect(formatDateString(null)).toBe("");
    expect(formatDateString(new Date(Number.NaN))).toBe("");
  });
});
