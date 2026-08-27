// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LoginForm } from "@/components/auth/login-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const authMocks = vi.hoisted(() => ({
  signInEmail: vi.fn(),
  sendVerificationOtp: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: {
      email: authMocks.signInEmail,
      emailOtp: vi.fn(),
    },
    emailOtp: {
      sendVerificationOtp: authMocks.sendVerificationOtp,
    },
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderLoginForm(
  emailOtpEnabled: boolean,
  queryClient = new QueryClient(),
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <LoginForm emailOtpEnabled={emailOtpEnabled} />
    </QueryClientProvider>,
  );
}

describe("登录方式", () => {
  it("管理员关闭验证码登录时只显示默认密码登录", () => {
    renderLoginForm(false);

    expect(screen.getByLabelText("密码")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "邮箱验证码登录" })).toBeNull();
  });

  it("管理员开启后允许切换到邮箱验证码模式", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    renderLoginForm(true);

    expect(screen.getByLabelText("密码")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "邮箱验证码登录" }));
    expect(screen.queryByLabelText("密码")).toBeNull();
    expect(screen.getByRole("button", { name: "发送验证码" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "密码登录" }));
    fireEvent.change(screen.getByLabelText("邮箱"), {
      target: { value: "user@example.com" },
    });

    expect(
      consoleError.mock.calls.some(([message]) =>
        String(message).includes("uncontrolled input to be controlled"),
      ),
    ).toBe(false);
    consoleError.mockRestore();
  });

  it("邮箱账号不存在时明确提示且不进入验证码步骤", async () => {
    authMocks.sendVerificationOtp.mockResolvedValue({
      data: null,
      error: { code: "EMAIL_NOT_FOUND", message: "邮箱不存在" },
    });
    renderLoginForm(true);

    fireEvent.click(screen.getByRole("button", { name: "邮箱验证码登录" }));
    fireEvent.change(screen.getByRole("textbox", { name: "邮箱" }), {
      target: { value: "missing@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送验证码" }));

    await waitFor(() => {
      expect(screen.getByText("邮箱不存在，请检查后重试")).toBeTruthy();
    });
    expect(screen.queryByLabelText("6 位验证码")).toBeNull();
  });

  it("登录成功时清除上一账号的查询缓存", async () => {
    authMocks.signInEmail.mockResolvedValue({ data: {}, error: null });
    const queryClient = new QueryClient();
    queryClient.setQueryData(["private-user-data"], { userId: "previous" });
    renderLoginForm(false, queryClient);

    fireEvent.change(screen.getByLabelText("邮箱"), {
      target: { value: "next@example.com" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() =>
      expect(queryClient.getQueryData(["private-user-data"])).toBeUndefined(),
    );
  });

  it("密码请求在途时锁定登录模式切换与再次提交，结束后恢复", async () => {
    let resolveLogin!: (value?: unknown) => void;
    authMocks.signInEmail.mockImplementation(
      () => new Promise((resolve) => (resolveLogin = resolve)),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    renderLoginForm(true);

    fireEvent.change(screen.getByLabelText("邮箱"), {
      target: { value: "user@example.com" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    // 在途期间：模式按钮全部禁用，防止另一模式携同一个 Turnstile token 提交
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "密码登录" })).toBeDisabled(),
    );
    expect(screen.getByRole("button", { name: "邮箱验证码登录" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "微信扫码登录" })).toBeDisabled();

    resolveLogin();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "邮箱验证码登录" }),
      ).not.toBeDisabled(),
    );
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("密码登录网络异常时提示并可恢复，不再悬挂旧 token 状态", async () => {
    authMocks.signInEmail.mockRejectedValue(new Error("network down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    renderLoginForm(false);

    fireEvent.change(screen.getByLabelText("邮箱"), {
      target: { value: "user@example.com" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    // 异常路径必须收敛为可见错误（内部同时重置挑战以便重试），而非 unhandled rejection
    await waitFor(() => {
      expect(screen.getByText("登录暂时不可用，请检查网络后重试")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "登录" })).toBeEnabled();
    expect(consoleError.mock.calls.some(([message]) => String(message).includes("unhandled"))).toBe(
      false,
    );
    consoleError.mockRestore();
  });
});
