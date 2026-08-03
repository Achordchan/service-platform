// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationPreferencesForm } from "@/components/shared/notification-preferences-form";
import { ToastProvider } from "@/components/shared/toast-provider";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("通知偏好设置", () => {
  it("通过 mutation 保存最新开关状态", async () => {
    let capturedRequest:
      | { url: string; method: string; body: unknown }
      | undefined;
    const fetchMock = vi.fn().mockImplementation(async (input: Request) => {
      capturedRequest = {
        url: input.url,
        method: input.method,
        body: await input.clone().json(),
      };
      return new Response(
        JSON.stringify({
          data: {
            soundNotificationsEnabled: true,
            requestEmailNotificationsEnabled: false,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <NotificationPreferencesForm
            initialPreferences={{
              soundNotificationsEnabled: false,
              requestEmailNotificationsEnabled: false,
            }}
          />
        </ToastProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("switch", { name: "页面提示音" }));
    fireEvent.click(screen.getByRole("button", { name: "保存通知设置" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(capturedRequest).toEqual({
      url: "http://localhost:3000/api/v1/me/notification-preferences",
      method: "PATCH",
      body: {
        soundNotificationsEnabled: true,
        requestEmailNotificationsEnabled: false,
      },
    });
    await screen.findByText("通知设置已保存");
  });
});
