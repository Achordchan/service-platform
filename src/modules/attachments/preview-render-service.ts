import "server-only";

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { env } from "@/lib/runtime-env";
import { withSystemDb } from "@/lib/system-db";
import {
  isOfficePreviewMimeType,
  officePreviewExtension,
} from "@/modules/attachments/attachment-meta";
import {
  createReplacementStorageKey,
  readPrivateFile,
  removePrivateFile,
  writePrivateFile,
} from "@/modules/attachments/private-storage";

const execFileAsync = promisify(execFile);

// 单文件转换上限：超时杀进程标记 FAILED，原文件不受影响仍可下载
const CONVERT_TIMEOUT_MS = 120_000;

function sofficePath() {
  return env.SOFFICE_PATH ?? "soffice";
}

/**
 * Office 附件（docx/xlsx/pptx）转 PDF 预览件。
 * pg-boss worker 调用；成功写入 previewStorageKey + READY，
 * 失败标记 FAILED 后重新抛出交给队列重试（重试耗尽即停在 FAILED）。
 */
export async function renderAttachmentPdfPreview(attachmentId: string) {
  const attachment = await withSystemDb((tx) =>
    tx.attachment.findUnique({
      where: { id: attachmentId },
      select: {
        id: true,
        storageKey: true,
        mimeType: true,
        previewStatus: true,
        previewStorageKey: true,
      },
    }),
  );
  if (!attachment) return;
  if (!isOfficePreviewMimeType(attachment.mimeType)) return;
  if (attachment.previewStatus === "READY" && attachment.previewStorageKey) {
    return;
  }

  let previewStorageKey: string | null = null;
  try {
    const sourceBuffer = await readPrivateFile(attachment.storageKey);
    const pdfBuffer = await convertOfficeToPdf(
      new Uint8Array(sourceBuffer),
      attachment.mimeType,
    );
    previewStorageKey = createReplacementStorageKey(
      attachment.storageKey,
      "pdf",
    );
    await writePrivateFile(previewStorageKey, pdfBuffer);
    const updated = await withSystemDb((tx) =>
      tx.attachment.updateMany({
        // storageKey 守卫：源文件在转换期间被替换（理论上仅图片类会发生）则放弃写入
        where: { id: attachment.id, storageKey: attachment.storageKey },
        data: { previewStorageKey, previewStatus: "READY" },
      }),
    );
    if (updated.count !== 1) {
      await removePrivateFile(previewStorageKey);
      return;
    }
    if (
      attachment.previewStorageKey &&
      attachment.previewStorageKey !== previewStorageKey
    ) {
      await removePrivateFile(attachment.previewStorageKey);
    }
  } catch (error) {
    if (previewStorageKey) {
      await removePrivateFile(previewStorageKey).catch(() => undefined);
    }
    await withSystemDb((tx) =>
      tx.attachment.updateMany({
        where: { id: attachment.id },
        data: { previewStatus: "FAILED" },
      }),
    ).catch(() => undefined);
    console.error(
      "ACHORD_ATTACHMENT_PREVIEW_FAILED",
      JSON.stringify({
        event: "attachment.preview_render_failed",
        attachmentId: attachment.id,
        mimeType: attachment.mimeType,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    throw error;
  }
}

/**
 * LibreOffice headless 转 PDF。每次使用独立临时目录与独立 UserInstallation
 * profile（并发/残留互不影响），完成后整目录清理。
 */
async function convertOfficeToPdf(buffer: Uint8Array, mimeType: string) {
  const extension = officePreviewExtension(mimeType);
  if (!extension) {
    throw new Error(`UNSUPPORTED_PREVIEW_MIME:${mimeType}`);
  }
  const workDir = await mkdtemp(path.join(os.tmpdir(), "attachment-preview-"));
  try {
    const inputPath = path.join(workDir, `source.${extension}`);
    const outDir = path.join(workDir, "out");
    const profileDir = path.join(workDir, "profile");
    await writeFile(inputPath, buffer);
    await execFileAsync(
      sofficePath(),
      [
        "--headless",
        "--norestore",
        "--nolockcheck",
        "--nodefault",
        "--nologo",
        `-env:UserInstallation=file://${profileDir}`,
        "--convert-to",
        "pdf",
        "--outdir",
        outDir,
        inputPath,
      ],
      {
        timeout: CONVERT_TIMEOUT_MS,
        env: { ...process.env, HOME: workDir },
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    const outputPath = path.join(outDir, `source.pdf`);
    const pdf = await readFile(outputPath);
    if (pdf.byteLength === 0) {
      throw new Error("EMPTY_PDF_OUTPUT");
    }
    return new Uint8Array(pdf);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// 供上传链路复用：命中转换类型时把初始状态标记为 PENDING
export function initialPreviewStatus(mimeType: string) {
  return isOfficePreviewMimeType(mimeType) ? ("PENDING" as const) : null;
}
