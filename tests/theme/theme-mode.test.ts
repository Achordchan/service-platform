import { describe, expect, it } from "vitest";
import {
  THEME_PREFERENCES,
  themePreferenceToMode,
} from "@/theme/theme-mode";

describe("theme mode", () => {
  it("maps every persisted preference to the MUI mode", () => {
    expect(THEME_PREFERENCES).toEqual(["SYSTEM", "LIGHT", "DARK"]);
    expect(themePreferenceToMode("SYSTEM")).toBe("system");
    expect(themePreferenceToMode("LIGHT")).toBe("light");
    expect(themePreferenceToMode("DARK")).toBe("dark");
  });
});
