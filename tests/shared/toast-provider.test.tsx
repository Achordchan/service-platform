// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  it("stacks operation and delivery feedback at the same time", async () => {
    renderProvider();
    fireEvent.click(screen.getByRole("button", { name: "显示两条" }));

    await waitFor(() => {
      expect(screen.getAllByRole("alert")).toHaveLength(2);
    });
    expect(screen.getByText("操作成功")).toBeTruthy();
    expect(screen.getByText(/钉钉机器人消息已进入发送队列/)).toBeTruthy();
  });

  it("only keeps the latest four messages visible to avoid covering the page", async () => {
    renderProvider();
    fireEvent.click(screen.getByRole("button", { name: "显示五条" }));

    await screen.findByText("消息 5");
    const firstToast = screen.getByText("消息 1").closest("[data-sonner-toast]");
    const latestToast = screen.getByText("消息 5").closest("[data-sonner-toast]");
    const visibleToasts = document.querySelectorAll(
      '[data-sonner-toast][data-visible="true"]',
    );

    expect(visibleToasts).toHaveLength(4);
    expect(firstToast?.getAttribute("data-visible")).toBe("false");
    expect(latestToast?.getAttribute("data-visible")).toBe("true");
  });
});
