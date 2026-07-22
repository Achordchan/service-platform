ALTER TABLE "PlatformSetting"
  ALTER COLUMN "mailReplyTo" SET DEFAULT '';

UPDATE "PlatformSetting"
SET "mailReplyTo" = ''
WHERE lower("mailReplyTo") = 'support@achord.cn';
