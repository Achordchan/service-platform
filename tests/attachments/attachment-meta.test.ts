import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_NOTE_MAX_LENGTH,
  ATTACHMENT_TITLE_MAX_LENGTH,
  attachmentRiskText,
  initialPreviewStatus,
  isInlinePreviewableMimeType,
  isOfficePreviewMimeType,
  normalizeAttachmentNote,
  normalizeAttachmentTitle,
  officePreviewExtension,
} from "@/modules/attachments/attachment-meta";

describe("normalizeAttachmentTitle", () => {
  it("空值与空白返回 null（展示端兜底 originalName）", () => {
    expect(normalizeAttachmentTitle(undefined)).toBeNull();
    expect(normalizeAttachmentTitle("")).toBeNull();
    expect(normalizeAttachmentTitle("   ")).toBeNull();
  });

  it("剔除控制字符并裁剪长度", () => {
    expect(normalizeAttachmentTitle(`  验收报告${String.fromCharCode(0)}v2  `)).toBe(
      "验收报告v2",
    );
    const long = "标".repeat(ATTACHMENT_TITLE_MAX_LENGTH + 10);
    expect(normalizeAttachmentTitle(long)).toHaveLength(
      ATTACHMENT_TITLE_MAX_LENGTH,
    );
  });
});

describe("normalizeAttachmentNote", () => {
  it("保留换行、剔除其他控制字符、裁剪长度", () => {
    expect(normalizeAttachmentNote(`第一行\n第二行${String.fromCharCode(7)}`)).toBe(
      "第一行\n第二行",
    );
    expect(normalizeAttachmentNote("  ")).toBeNull();
    const long = "备".repeat(ATTACHMENT_NOTE_MAX_LENGTH + 10);
    expect(normalizeAttachmentNote(long)).toHaveLength(
      ATTACHMENT_NOTE_MAX_LENGTH,
    );
  });
});

describe("attachmentRiskText", () => {
  it("拼装文件名、标题、备注供内容风控扫描", () => {
    expect(attachmentRiskText("a.pdf", "标题", "备注")).toBe(
      "a.pdf\n标题\n备注",
    );
    expect(attachmentRiskText("a.pdf", null, null)).toBe("a.pdf");
  });
});

describe("office 预览类型判定", () => {
  const DOCX =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const XLSX =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const PPTX =
    "application/vnd.openxmlformats-officedocument.presentationml.presentation";

  it("docx/xlsx/pptx 命中转换，其余不命中", () => {
    expect(isOfficePreviewMimeType(DOCX)).toBe(true);
    expect(isOfficePreviewMimeType(XLSX)).toBe(true);
    expect(isOfficePreviewMimeType(PPTX)).toBe(true);
    expect(isOfficePreviewMimeType("application/pdf")).toBe(false);
    expect(isOfficePreviewMimeType("image/png")).toBe(false);
    expect(isOfficePreviewMimeType("text/plain")).toBe(false);
  });

  it("转换输入扩展名与初始预览状态", () => {
    expect(officePreviewExtension(DOCX)).toBe("docx");
    expect(officePreviewExtension(XLSX)).toBe("xlsx");
    expect(officePreviewExtension(PPTX)).toBe("pptx");
    expect(officePreviewExtension("application/pdf")).toBeNull();
    expect(initialPreviewStatus(DOCX)).toBe("PENDING");
    expect(initialPreviewStatus("application/pdf")).toBeNull();
  });
});

describe("内联预览白名单", () => {
  it("图片/PDF/纯文本类允许 inline，其余强制下载", () => {
    expect(isInlinePreviewableMimeType("image/webp")).toBe(true);
    expect(isInlinePreviewableMimeType("application/pdf")).toBe(true);
    expect(isInlinePreviewableMimeType("text/plain")).toBe(true);
    expect(isInlinePreviewableMimeType("text/csv")).toBe(true);
    expect(isInlinePreviewableMimeType("application/json")).toBe(true);
    expect(isInlinePreviewableMimeType("text/html")).toBe(false);
    // SVG 可内嵌脚本，即使上游校验不放行也显式排除（深度防御）
    expect(isInlinePreviewableMimeType("image/svg+xml")).toBe(false);
    expect(
      isInlinePreviewableMimeType(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(false);
  });
});
