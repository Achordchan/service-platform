ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PROJECT_CREATED';

INSERT INTO "NotificationDeliveryRule" (
  "key",
  "notificationEnabled",
  "soundEnabled",
  "emailEnabled",
  "dingtalkEnabled",
  "updatedAt"
)
VALUES (
  'PROJECT_CREATED',
  true,
  true,
  false,
  false,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
