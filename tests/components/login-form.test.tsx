// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/components/auth/login-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const authMocks = vi.hoisted(() => ({
  sendVerificationOtp: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: {
      email: vi.fn(),
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

describe("登录方式", () => {
  it("管理员关闭验证码登录时只显示默认密码登录", () => {
    render(<LoginForm emailOtpEnabled={false} />);

    expect(screen.getByLabelText("密码")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "邮箱验证码登录" })).toBeNull();
  });

  it("管理员开启后允许切换到邮箱验证码模式", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<LoginForm emailOtpEnabled />);

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
    render(<LoginForm emailOtpEnabled />);

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
});
