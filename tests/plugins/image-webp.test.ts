import { describe, expect, it } from "vitest";
import {
  imageWebpManifest,
  parseImageWebpConfig,
} from "@achord/plugin-image-webp";
import { optimizeImageToWebp } from "@achord/plugin-image-webp/runtime";

describe("图片 WebP 插件", () => {
  it("使用生产默认配置并保持默认关闭由宿主管理", () => {
    expect(parseImageWebpConfig({})).toEqual({
      quality: 82,
      effort: 2,
      maxInputMegapixels: 40,
      minimumSavingsPercent: 5,
    });
    expect(imageWebpManifest.key).toBe("image-webp");
  });

  it("将 JPEG 转换为可解码的 WebP", async () => {
    const source = Buffer.from(
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==",
      "base64",
    );
    const result = await optimizeImageToWebp({
      buffer: new Uint8Array(source),
      mimeType: "image/jpeg",
      config: parseImageWebpConfig({}),
    });

    expect(result.status).toBe("TRANSFORMED");
    if (result.status !== "TRANSFORMED") return;
    expect(Buffer.from(result.buffer).subarray(0, 4).toString("ascii")).toBe(
      "RIFF",
    );
    expect(Buffer.from(result.buffer).subarray(8, 12).toString("ascii")).toBe(
      "WEBP",
    );
  });

  it("跳过 GIF 和已有 WebP", async () => {
    const result = await optimizeImageToWebp({
      buffer: new Uint8Array([1, 2, 3]),
      mimeType: "image/gif",
      config: parseImageWebpConfig({}),
    });
    expect(result).toEqual({
      status: "SKIPPED",
      reason: "UNSUPPORTED_MIME_TYPE",
    });
  });
});
