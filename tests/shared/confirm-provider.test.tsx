// @vitest-environment jsdom

import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AppConfirmProvider,
  useAppConfirm,
} from "@/components/shared/confirm-provider";
import { appTheme } from "@/theme/theme";

afterEach(cleanup);

function ConfirmTrigger({ onConfirm }: { onConfirm: () => void }) {
  const confirm = useAppConfirm();
  const [result, setResult] = useState("");

  async function openConfirm() {
    const confirmed = await confirm({
      title: "删除测试数据？",
      description: "删除后无法恢复。",
      confirmationButtonProps: { color: "error", variant: "contained" },
    });
    setResult(confirmed ? "confirm" : "cancel");
    if (confirmed) onConfirm();
  }

  return (
    <>
      <button type="button" onClick={() => void openConfirm()}>
        打开确认框
      </button>
      <output>{result}</output>
    </>
  );
}

function renderProvider(onConfirm: () => void) {
  return render(
    <ThemeProvider theme={appTheme}>
      <AppConfirmProvider>
        <ConfirmTrigger onConfirm={onConfirm} />
      </AppConfirmProvider>
    </ThemeProvider>,
  );
}

describe("AppConfirmProvider", () => {
  it("uses Chinese defaults and stops the action when cancelled", async () => {
    const onConfirm = vi.fn();
    renderProvider(onConfirm);

    fireEvent.click(screen.getByRole("button", { name: "打开确认框" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText("删除测试数据？")).toBeTruthy();
    expect(screen.getByText("删除后无法恢复。")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.getByText("cancel")).toBeTruthy());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("runs the action only after explicit confirmation", async () => {
    const onConfirm = vi.fn();
    renderProvider(onConfirm);

    fireEvent.click(screen.getByRole("button", { name: "打开确认框" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(screen.getByText("confirm")).toBeTruthy();
  });

  it("ignores rapid duplicate confirmation requests", async () => {
    const onConfirm = vi.fn();
    renderProvider(onConfirm);

    const trigger = screen.getByRole("button", { name: "打开确认框" });
    fireEvent.click(trigger);
    fireEvent.click(trigger);

    expect(await screen.findAllByRole("dialog")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
  });
});
