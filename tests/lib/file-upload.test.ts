import { describe, expect, it, vi } from "vitest";
import { fileNames, uploadFilesBestEffort } from "@/lib/file-upload";

describe("附件批量上传", () => {
  it("单个文件失败时继续处理剩余文件并只返回失败项", async () => {
    const files = [
      new File(["a"], "a.txt"),
      new File(["b"], "b.txt"),
      new File(["c"], "c.txt"),
    ];
    const upload = vi.fn(async (file: File) => {
      if (file.name === "b.txt") throw new Error("UPLOAD_FAILED");
    });

    const failed = await uploadFilesBestEffort(files, upload);

    expect(upload).toHaveBeenCalledTimes(3);
    expect(failed).toEqual([files[1]]);
    expect(fileNames(failed)).toBe("b.txt");
  });
});
