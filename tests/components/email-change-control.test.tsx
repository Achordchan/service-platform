// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailChangeControl } from "@/components/shared/email-change-control";

const apiRequestMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-client", () => ({
  apiRequest: apiRequestMock,
  jsonRequest: (method: string, body?: unknown) => ({ method, json: body }),
}));

vi.mock("@/components/shared/toast-provider", () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: toastErrorMock,
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    delivery: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("邮箱变更控件", () => {
  it("先校验邮箱，再提交 POST body，并支持重发和取消", async () => {
    const pending = {
      id: "change-1",
      newEmail: "next@example.test",
      expiresAt: "2026-08-02T00:00:00.000Z",
      lastSentAt: "2026-08-01T00:00:00.000Z",
      mailStatus: "QUEUED",
      mailDispatchFailed: false,
    };
    apiRequestMock
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({ ...pending, lastSentAt: "2026-08-01T01:00:00.000Z" })
      .mockResolvedValueOnce(undefined);
    const onChanged = vi.fn();
    const onBusyChange = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <EmailChangeControl
          currentEmail="current@example.test"
          initialPending={null}
          apiBase="/api/v1/account/email-change"
          warning="修改邮箱需要新邮箱确认。"
          onChanged={onChanged}
          onBusyChange={onBusyChange}
        />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText("新的登录邮箱"), {
      target: { value: "invalid" },
    });
    const form = screen.getByRole("button", { name: "发送验证邮件" }).closest("form");
    expect(form).toBeTruthy();
    fireEvent.submit(form!);
    expect(apiRequestMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("新的登录邮箱"), {
      target: { value: "  next@example.test  " },
    });
    fireEvent.submit(form!);

    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledOnce());
    expect(apiRequestMock).toHaveBeenCalledWith(
      "/api/v1/account/email-change",
      { method: "POST", json: { newEmail: "next@example.test" } },
      "邮箱变更操作失败",
    );
    expect(onChanged).toHaveBeenCalledOnce();
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "验证邮件已加入发件箱，请前往新邮箱确认",
    );

    fireEvent.click(screen.getByRole("button", { name: "重新发送验证邮件" }));
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledTimes(2));
    expect(apiRequestMock).toHaveBeenLastCalledWith(
      "/api/v1/account/email-change/resend",
      { method: "POST", json: undefined },
      "邮箱变更操作失败",
    );

    fireEvent.click(screen.getByRole("button", { name: "取消修改" }));
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledTimes(3));
    expect(apiRequestMock).toHaveBeenLastCalledWith(
      "/api/v1/account/email-change",
      { method: "DELETE", json: undefined },
      "邮箱变更操作失败",
    );
    expect(screen.getByLabelText("新的登录邮箱")).toBeTruthy();
  });
});
