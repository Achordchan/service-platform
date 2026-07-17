import { createRequire } from "node:module";
import { resolve } from "node:path";
import type {
  BinaryTransformInput,
  BinaryTransformResult,
} from "@achord/platform-plugin-sdk";
import type { ImageWebpConfig } from "./manifest";

const requireFromApp = createRequire(resolve(process.cwd(), "package.json"));
const sharpPackageName = ["sh", "arp"].join("");
const sharp = requireFromApp(sharpPackageName) as (
  typeof import("sharp")
)["default"];

sharp.concurrency(1);
sharp.cache({ memory: 32, files: 0, items: 32 });

export function getImageWebpRuntimeHealth() {
  return {
    sharpVersion: sharp.versions.sharp,
    webpVersion: sharp.versions.webp ?? "unknown",
  };
}

export async function optimizeImageToWebp(
  input: BinaryTransformInput<ImageWebpConfig>,
): Promise<BinaryTransformResult> {
  if (!["image/jpeg", "image/png"].includes(input.mimeType)) {
    return { status: "SKIPPED", reason: "UNSUPPORTED_MIME_TYPE" };
  }

  const limitInputPixels = input.config.maxInputMegapixels * 1_000_000;
  let output: Buffer;
  let outputMetadata: {
    format?: string;
    width?: number;
    height?: number;
  };
  try {
    const source = sharp(input.buffer, {
      failOn: "error",
      limitInputPixels,
      sequentialRead: true,
    });
    const sourceMetadata = await source.metadata();
    if (!sourceMetadata.width || !sourceMetadata.height) {
      return { status: "SKIPPED", reason: "MISSING_DIMENSIONS" };
    }
    output = await source
      .rotate()
      .webp({
        quality: input.config.quality,
        effort: input.config.effort,
        smartSubsample: true,
      })
      .toBuffer();
    outputMetadata = await sharp(output, {
      failOn: "error",
      limitInputPixels,
    }).metadata();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/pixel limit|limitInputPixels/i.test(message)) {
      return { status: "SKIPPED", reason: "INPUT_PIXEL_LIMIT" };
    }
    throw error;
  }
  if (
    outputMetadata.format !== "webp" ||
    !outputMetadata.width ||
    !outputMetadata.height
  ) {
    throw new Error("WEBP_OUTPUT_VALIDATION_FAILED");
  }

  return {
    status: "TRANSFORMED",
    buffer: new Uint8Array(output),
    mimeType: "image/webp",
    extension: "webp",
    width: outputMetadata.width,
    height: outputMetadata.height,
  };
}
