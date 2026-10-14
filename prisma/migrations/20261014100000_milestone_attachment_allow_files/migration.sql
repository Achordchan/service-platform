-- 里程碑除了正文内嵌图（inline = true），也允许直接挂文件附件（inline = false）。
-- 旧检查约束要求 milestoneId 非空时 inline 必须为 true，导致「创建里程碑后补传附件」
-- 在 INSERT 时恒触发 23514。这里保留「里程碑附件不能同时挂其它父级」的互斥语义，只去掉 inline = true。
ALTER TABLE "Attachment"
  DROP CONSTRAINT IF EXISTS "Attachment_milestone_parent_exclusive_check";

ALTER TABLE "Attachment"
  ADD CONSTRAINT "Attachment_milestone_parent_exclusive_check"
  CHECK (
    "milestoneId" IS NULL
    OR (
      "serviceRequestId" IS NULL
      AND "requestMessageId" IS NULL
      AND "projectUpdateId" IS NULL
      AND "updateCommentId" IS NULL
      AND "supportPlaybookKey" IS NULL
    )
  );
