// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileSettingsForm } from "@/components/shared/profile-settings-form";
import { ToastProvider } from "@/components/shared/toast-provider";
import { createEmbedTheme } from "@/theme/theme";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const user = {
  id: "user-1",
  name: "测试用户",
  email: "user@example.test",
  image: null,
};

function renderForm(
  pending: React.ComponentProps<
    typeof ProfileSettingsForm
  >["initialPendingEmailChange"] = null,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <ThemeProvider theme={createEmbedTheme("light")}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <ProfileSettingsForm
            user={user}
            initialPendingEmailChange={pending}
          />
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProfileSettingsForm email states", () => {
  it("keeps email change controls collapsed by default", () => {
    renderForm();

    expect(screen.getByRole("button", { name: "修改邮箱" })).toBeTruthy();
    expect(screen.queryByText("修改登录邮箱")).toBeNull();
    expect(screen.queryByLabelText("新的登录邮箱")).toBeNull();
  });

  it("expands email change controls on demand", () => {
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: "修改邮箱" }));

    expect(screen.getByText("修改登录邮箱")).toBeTruthy();
    expect(screen.getByLabelText("新的登录邮箱")).toBeTruthy();
    expect(screen.getByRole("button", { name: "收起" })).toBeTruthy();
  });

  it("automatically shows a pending email change", () => {
    renderForm({
      id: "change-1",
      newEmail: "next@example.test",
      expiresAt: "2026-07-26T08:00:00.000Z",
      lastSentAt: "2026-07-25T08:00:00.000Z",
      mailStatus: "SENT",
      mailDispatchFailed: false,
    });

    expect(screen.getByText("等待确认")).toBeTruthy();
    expect(screen.getByText("修改登录邮箱")).toBeTruthy();
    expect(screen.getByText("等待新邮箱确认")).toBeTruthy();
    expect(screen.getByText("新邮箱：next@example.test")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "修改邮箱" })).toBeNull();
  });
});
