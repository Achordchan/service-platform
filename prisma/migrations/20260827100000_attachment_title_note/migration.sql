-- 附件展示标题与备注：上传时可自定义显示标题（默认用文件名）、附加备注。
-- 两列均可空；originalName 仍是下载文件名与兜底展示名。

ALTER TABLE "Attachment"
  ADD COLUMN "title" TEXT,
  ADD COLUMN "note" TEXT;
