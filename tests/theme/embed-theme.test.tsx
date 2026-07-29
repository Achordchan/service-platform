// @vitest-environment jsdom

import { Box } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { appTheme, createEmbedTheme } from "@/theme/theme";

describe("embed theme", () => {
  it("defines light and dark application color schemes", () => {
    expect(appTheme.colorSchemeSelector).toBe("data-mui-color-scheme");
    expect(appTheme.colorSchemes.light!.palette.mode).toBe("light");
    expect(appTheme.colorSchemes.dark!.palette.mode).toBe("dark");
    expect(appTheme.colorSchemes.dark!.palette.background.default).toBe(
      "#111418",
    );
  });

  it("creates an isolated dark theme without outer CSS variables", () => {
    const theme = createEmbedTheme("dark");
    expect(theme.palette.mode).toBe("dark");
    expect(theme.palette.background.default).toBe("#111418");
    expect(theme.vars).toBeUndefined();
  });

  it("renders background.default as the dark embed color", () => {
    const view = render(
      <ThemeProvider theme={createEmbedTheme("dark")}>
        <Box data-testid="shell" sx={{ bgcolor: "background.default" }} />
      </ThemeProvider>,
    );
    expect(
      getComputedStyle(view.getByTestId("shell")).backgroundColor,
    ).toBe("rgb(17, 20, 24)");
  });
});
