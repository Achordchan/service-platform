// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeModeMenu } from "@/components/shared/theme-mode-menu";
import { ToastProvider } from "@/components/shared/toast-provider";
import { appTheme } from "@/theme/theme";
import { THEME_MODE_STORAGE_KEY } from "@/theme/theme-mode";

function renderMenu() {
  return render(
    <ThemeProvider
      theme={appTheme}
      defaultMode="system"
      modeStorageKey={THEME_MODE_STORAGE_KEY}
    >
      <ToastProvider>
        <ThemeModeMenu initialPreference="SYSTEM" />
      </ToastProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ThemeModeMenu", () => {
  it("switches and persists the selected mode", async () => {
    let capturedRequest:
      | { url: string; method: string; body: unknown }
      | undefined;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const request = input as Request;
        capturedRequest = {
          url: request.url,
          method: request.method,
          body: await request.clone().json(),
        };
        return new Response(
        JSON.stringify({ data: { themePreference: "DARK" } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });
    renderMenu();

    fireEvent.click(
      screen.getByRole("button", { name: "切换外观，当前跟随系统" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "深色" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(capturedRequest).toEqual({
      url: "http://localhost:3000/api/v1/me/appearance-preference",
      method: "PATCH",
      body: { themePreference: "DARK" },
    });
    await waitFor(() => {
      expect(localStorage.getItem(THEME_MODE_STORAGE_KEY)).toBe("dark");
      expect(
        screen.getByRole("button", { name: "切换外观，当前深色" }),
      ).toBeTruthy();
    });
  });

  it("rolls back the mode when saving fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: "外观设置保存失败" } }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      ),
    );
    renderMenu();

    fireEvent.click(
      screen.getByRole("button", { name: "切换外观，当前跟随系统" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "深色" }));

    await screen.findByText("外观设置保存失败");
    await waitFor(() => {
      expect(localStorage.getItem(THEME_MODE_STORAGE_KEY)).toBe("system");
      expect(
        screen.getByRole("button", { name: "切换外观，当前跟随系统" }),
      ).toBeTruthy();
    });
  });
});
