ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REQUEST_CLAIMED';

INSERT INTO "NotificationDeliveryRule" (
  "key",
  "notificationEnabled",
  "soundEnabled",
  "emailEnabled",
  "dingtalkEnabled",
  "updatedAt"
)
VALUES (
  'REQUEST_CLAIMED',
  true,
  true,
  true,
  false,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE SET
  "notificationEnabled" = true,
  "soundEnabled" = true,
  "emailEnabled" = true,
  "dingtalkEnabled" = false,
  "updatedAt" = CURRENT_TIMESTAMP;
