// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { describe, expect, it } from "vitest";
import {
  TabBadgeLabel,
  UnreadDot,
} from "@/components/shared/tab-badge-label";
import { appTheme } from "@/theme/theme";

function renderLabel(count?: number) {
  return render(
    <ThemeProvider theme={appTheme}>
      <TabBadgeLabel label="已归档" count={count} />
    </ThemeProvider>,
  );
}

describe("TabBadgeLabel", () => {
  it("does not reserve an unread badge when the count is zero", () => {
    renderLabel(0);

    expect(screen.getByText("已归档")).toBeTruthy();
    expect(screen.queryByLabelText(/条未读/)).toBeNull();
  });

  it.each([
    [1, "1"],
    [99, "99"],
    [100, "99+"],
  ])("renders %s unread items as %s inside the tab layout", (count, text) => {
    renderLabel(count);

    const badge = screen.getByLabelText(`${count} 条未读`);
    expect(badge.textContent).toBe(text);
    expect(getComputedStyle(badge).position).not.toBe("absolute");
    expect(getComputedStyle(badge).flexShrink).toBe("0");
  });

  it("renders a fixed red dot for an unread request row", () => {
    render(
      <ThemeProvider theme={appTheme}>
        <UnreadDot count={2} />
      </ThemeProvider>,
    );

    const dot = screen.getByLabelText("2 条未读更新");
    expect(getComputedStyle(dot).width).toBe("8px");
    expect(getComputedStyle(dot).height).toBe("8px");
    expect(getComputedStyle(dot).flexShrink).toBe("0");
  });
});
