// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FilePickerButton,
  IMAGE_FILE_ACCEPT,
  firstFileRejectionMessage,
} from "@/components/shared/file-picker";

afterEach(cleanup);

function dropFile(target: HTMLElement, file: File) {
  fireEvent.drop(target, {
    dataTransfer: {
      files: [file],
      items: [
        {
          kind: "file",
          type: file.type,
          getAsFile: () => file,
        },
      ],
      types: ["Files"],
    },
  });
}

describe("FilePickerButton", () => {
  it("accepts files from drag and drop", async () => {
    const onFiles = vi.fn();
    render(
      <FilePickerButton multiple onFiles={onFiles}>
        添加附件
      </FilePickerButton>,
    );
    const file = new File(["content"], "example.txt", { type: "text/plain" });

    dropFile(screen.getByRole("button", { name: "添加附件" }), file);

    await waitFor(() => expect(onFiles).toHaveBeenCalledWith([file], expect.anything()));
  });

  it("returns localized rejection reasons", async () => {
    const onFiles = vi.fn();
    const onRejected = vi.fn();
    render(
      <FilePickerButton
        accept={IMAGE_FILE_ACCEPT}
        onFiles={onFiles}
        onRejected={onRejected}
      >
        选择图片
      </FilePickerButton>,
    );
    const file = new File(["content"], "document.txt", { type: "text/plain" });

    dropFile(screen.getByRole("button", { name: "选择图片" }), file);

    await waitFor(() => expect(onRejected).toHaveBeenCalledOnce());
    const rejections = onRejected.mock.calls[0]?.[0];
    expect(firstFileRejectionMessage(rejections)).toBe(
      "document.txt 的文件类型不受支持",
    );
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("supports the extension list returned by attachment policy", async () => {
    const onFiles = vi.fn();
    render(
      <FilePickerButton accept=".pdf,.txt" onFiles={onFiles}>
        添加附件
      </FilePickerButton>,
    );
    const file = new File(["content"], "notes.txt", { type: "text/plain" });

    dropFile(screen.getByRole("button", { name: "添加附件" }), file);

    await waitFor(() => expect(onFiles).toHaveBeenCalledWith([file], expect.anything()));
  });

  it("rejects files larger than the configured limit", async () => {
    const onRejected = vi.fn();
    render(
      <FilePickerButton
        maxSize={3}
        onFiles={vi.fn()}
        onRejected={onRejected}
      >
        上传文件
      </FilePickerButton>,
    );
    const file = new File(["large"], "large.txt", { type: "text/plain" });

    dropFile(screen.getByRole("button", { name: "上传文件" }), file);

    await waitFor(() => expect(onRejected).toHaveBeenCalledOnce());
    expect(firstFileRejectionMessage(onRejected.mock.calls[0]?.[0])).toBe(
      "large.txt 超过允许的文件大小",
    );
  });
});
