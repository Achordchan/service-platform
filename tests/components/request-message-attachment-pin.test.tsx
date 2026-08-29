// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestMessageAttachments } from "@/components/shared/request-chat-attachments";
import type { ChatAttachment } from "@/components/shared/request-chat-types";

function attachment(overrides: Partial<ChatAttachment>): ChatAttachment {
  return {
    id: "attachment-1",
    originalName: "图纸.png",
    mimeType: "image/png",
    size: 1024,
    createdAt: new Date("2026-08-29T00:00:00Z").toISOString(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("工单附件收录入口", () => {
  it("图片和文档都能添加到项目文件", () => {
    const onPinToProject = vi.fn();
    render(
      <RequestMessageAttachments
        files={[
          attachment({ id: "image-1", originalName: "图纸.png" }),
          attachment({
            id: "doc-1",
            originalName: "验收单.pdf",
            mimeType: "application/pdf",
          }),
        ]}
        tone="other"
        onPinToProject={onPinToProject}
      />,
    );

    // 图片走 MessageImage、文档走 MessageFile：只给其中一支接上收录回调的话，
    // Web 端就只有文档能收录，而小程序长按图片是可以的。
    fireEvent.click(
      screen.getByRole("button", { name: "把 图纸.png 添加到项目文件" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "把 验收单.pdf 添加到项目文件" }),
    );

    expect(onPinToProject.mock.calls.map(([file]) => file.id)).toEqual([
      "image-1",
      "doc-1",
    ]);
  });

  it("没有收录权限时两支都不出按钮", () => {
    render(
      <RequestMessageAttachments
        files={[
          attachment({ id: "image-1" }),
          attachment({
            id: "doc-1",
            originalName: "验收单.pdf",
            mimeType: "application/pdf",
          }),
        ]}
        tone="other"
      />,
    );

    expect(
      screen.queryAllByRole("button", { name: /添加到项目文件/ }),
    ).toHaveLength(0);
  });

  it("点收录不会同时弹开图片灯箱", () => {
    const onPinToProject = vi.fn();
    render(
      <RequestMessageAttachments
        files={[attachment({ id: "image-1" })]}
        tone="other"
        onPinToProject={onPinToProject}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "把 图纸.png 添加到项目文件" }),
    );

    expect(onPinToProject).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
