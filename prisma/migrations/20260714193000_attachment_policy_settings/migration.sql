-- Attachment policy for customer uploads
ALTER TABLE "PlatformSetting"
  ADD COLUMN IF NOT EXISTS "attachmentMaxSizeMb" INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "PlatformSetting"
  ADD COLUMN IF NOT EXISTS "attachmentAllowedExtensions" TEXT NOT NULL DEFAULT 'jpg,jpeg,png,gif,webp,pdf,docx,xlsx,pptx,txt,log,csv,json';
ALTER TABLE "PlatformSetting"
  ADD COLUMN IF NOT EXISTS "customerReplyAttachmentsEnabled" BOOLEAN NOT NULL DEFAULT true;
