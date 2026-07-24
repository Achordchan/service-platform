// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { afterEach, describe, expect, it } from "vitest";
import { ToastProvider, useToast } from "@/components/shared/toast-provider";
import { appTheme } from "@/theme/theme";

afterEach(cleanup);

function ToastTrigger() {
  const toast = useToast();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          toast.success("操作成功");
          toast.delivery({
            notificationCount: 2,
            emailCount: 1,
            emailTiming: "IMMEDIATE",
            dingtalkQueued: true,
          });
        }}
      >
        显示两条
      </button>
      <button
        type="button"
        onClick={() => {
          for (let index = 1; index <= 5; index += 1) {
            toast.info(`消息 ${index}`);
          }
        }}
      >
        显示五条
      </button>
    </>
  );
}

function renderProvider() {
  return render(
    <ThemeProvider theme={appTheme}>
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>
    </ThemeProvider>,
  );
}

describe("ToastProvider", () => {
  it("stacks operation and delivery feedback at the same time", () => {
    renderProvider();
    fireEvent.click(screen.getByRole("button", { name: "显示两条" }));

    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(2);
    expect(screen.getByText("操作成功")).toBeTruthy();
    expect(screen.getByText(/钉钉机器人消息已进入发送队列/)).toBeTruthy();
  });

  it("keeps the latest four messages to avoid covering the page", () => {
    renderProvider();
    fireEvent.click(screen.getByRole("button", { name: "显示五条" }));

    expect(screen.getAllByRole("alert")).toHaveLength(4);
    expect(screen.queryByText("消息 1")).toBeNull();
    expect(screen.getByText("消息 5")).toBeTruthy();
  });
});
