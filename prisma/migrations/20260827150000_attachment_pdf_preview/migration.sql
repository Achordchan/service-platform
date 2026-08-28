-- Office 附件（docx/xlsx/pptx）异步转 PDF 预览件：
-- previewStorageKey 指向派生 PDF；previewStatus 记录生成状态（null = 无需转换）。
-- 存量附件不回填，预览仅对新上传生效。

CREATE TYPE "AttachmentPreviewStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

ALTER TABLE "Attachment"
  ADD COLUMN "previewStorageKey" TEXT,
  ADD COLUMN "previewStatus" "AttachmentPreviewStatus";
