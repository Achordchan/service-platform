// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DINGTALK_ROBOT_DEFAULT_CONFIG,
  type DingTalkRobotConfig,
} from "@achord/plugin-dingtalk-robot/config";
import { DingTalkTemplateSettings } from "@/components/staff/dingtalk-template-settings";
import { appTheme } from "@/theme/theme";

afterEach(cleanup);

function renderSettings({
  onSave = vi.fn().mockResolvedValue(true),
  onTest = vi.fn().mockResolvedValue(undefined),
  busy = false,
  canTest = true,
}: {
  onSave?: (config: DingTalkRobotConfig) => Promise<boolean>;
  onTest?: (
    eventType: Parameters<NonNullable<React.ComponentProps<typeof DingTalkTemplateSettings>["onTest"]>>[0],
    template: Parameters<NonNullable<React.ComponentProps<typeof DingTalkTemplateSettings>["onTest"]>>[1],
  ) => Promise<void>;
  busy?: boolean;
  canTest?: boolean;
} = {}) {
  return render(
    <ThemeProvider theme={appTheme}>
      <DingTalkTemplateSettings
        config={DINGTALK_ROBOT_DEFAULT_CONFIG}
        busy={busy}
        canTest={canTest}
        onSave={onSave}
        onTest={onTest}
      />
    </ThemeProvider>,
  );
}

function openFirstEditor() {
  fireEvent.click(screen.getByRole("button", { name: "钉钉通知模板" }));
  fireEvent.click(screen.getAllByRole("button", { name: "编辑" })[0]);
}

describe("钉钉通知模板编辑器", () => {
  it("打开模板后初始化表单，并保存清洗后的标题和正文", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    renderSettings({ onSave });

    openFirstEditor();
    const title = screen.getByRole("textbox", { name: "消息标题" });
    const body = screen.getByRole("textbox", { name: "Markdown 正文" });
    expect((title as HTMLInputElement).value).toBe(
      DINGTALK_ROBOT_DEFAULT_CONFIG.templates.REQUEST_CREATED.title,
    );

    fireEvent.change(title, { target: { value: "  自定义标题  " } });
    fireEvent.change(body, { target: { value: "  自定义正文  " } });
    expect(
      await screen.findByText((content) =>
        content.includes("工单通知") && content.includes("自定义标题"),
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "保存模板" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        templates: expect.objectContaining({
          REQUEST_CREATED: { title: "自定义标题", body: "自定义正文" },
        }),
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("标题和正文为空时显示校验错误并阻止保存", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    renderSettings({ onSave });

    openFirstEditor();
    fireEvent.change(screen.getByRole("textbox", { name: "消息标题" }), {
      target: { value: "   " },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown 正文" }), {
      target: { value: "   " },
    });

    expect(await screen.findByText("请填写消息标题")).toBeTruthy();
    expect(await screen.findByText("请填写 Markdown 正文")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "保存模板" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("恢复默认后可发送当前模板测试消息", async () => {
    const onTest = vi.fn().mockResolvedValue(undefined);
    renderSettings({ onTest });

    openFirstEditor();
    const title = screen.getByRole("textbox", { name: "消息标题" });
    fireEvent.change(title, { target: { value: "临时修改" } });
    fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));
    expect((title as HTMLInputElement).value).toBe(
      DINGTALK_ROBOT_DEFAULT_CONFIG.templates.REQUEST_CREATED.title,
    );

    fireEvent.click(screen.getByRole("button", { name: "发送测试" }));

    await waitFor(() => expect(onTest).toHaveBeenCalledOnce());
    expect(onTest).toHaveBeenCalledWith(
      "REQUEST_CREATED",
      DINGTALK_ROBOT_DEFAULT_CONFIG.templates.REQUEST_CREATED,
    );
  });
});
