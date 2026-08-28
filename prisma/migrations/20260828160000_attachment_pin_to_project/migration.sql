-- 「添加到项目文件」：把工单聊天/动态里的附件显式收录进项目文件列表。
-- 刻意不改 serviceRequestId 等归属字段：attachment_access 策略仍按原归属裁决，
-- 看不到源工单的人即使文件被收录也读不到，收录不会放宽任何可见性。
ALTER TABLE "Attachment"
  ADD COLUMN IF NOT EXISTS "pinnedToProjectAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pinnedById" TEXT;

CREATE INDEX IF NOT EXISTS "Attachment_projectId_pinnedToProjectAt_idx"
  ON "Attachment"("projectId", "pinnedToProjectAt");
