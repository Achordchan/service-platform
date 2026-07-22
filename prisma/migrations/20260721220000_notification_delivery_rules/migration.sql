CREATE TABLE "NotificationDeliveryRule" (
  "key" TEXT NOT NULL,
  "notificationEnabled" BOOLEAN NOT NULL DEFAULT true,
  "soundEnabled" BOOLEAN NOT NULL DEFAULT true,
  "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedById" TEXT,
  CONSTRAINT "NotificationDeliveryRule_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "NotificationDeliveryRule_updatedAt_idx"
  ON "NotificationDeliveryRule"("updatedAt");

ALTER TABLE "NotificationDeliveryRule"
  ADD CONSTRAINT "NotificationDeliveryRule_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "NotificationDeliveryRule"
  ("key", "notificationEnabled", "soundEnabled", "emailEnabled", "updatedAt")
VALUES
  ('PROJECT_UPDATE', true, true, false, CURRENT_TIMESTAMP),
  ('PROJECT_STAGE', true, true, false, CURRENT_TIMESTAMP),
  ('PROJECT_MILESTONE', true, true, false, CURRENT_TIMESTAMP),
  ('PROJECT_FILE', true, true, false, CURRENT_TIMESTAMP),
  ('REQUEST_CREATED', true, true, true, CURRENT_TIMESTAMP),
  ('REQUEST_ASSIGNED', true, true, true, CURRENT_TIMESTAMP),
  ('REQUEST_PUBLIC_MESSAGE', true, true, true, CURRENT_TIMESTAMP),
  ('REQUEST_INTERNAL_NOTE', true, true, false, CURRENT_TIMESTAMP),
  ('REQUEST_STATUS', true, true, true, CURRENT_TIMESTAMP),
  ('REQUEST_ATTACHMENT', true, true, false, CURRENT_TIMESTAMP),
  ('REQUEST_ARCHIVE', true, true, false, CURRENT_TIMESTAMP);

ALTER TABLE "NotificationDeliveryRule" ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_delivery_rule_read ON "NotificationDeliveryRule"
  FOR SELECT USING (true);

CREATE POLICY notification_delivery_rule_admin_write ON "NotificationDeliveryRule"
  FOR INSERT
  WITH CHECK (app_is_platform_admin());

CREATE POLICY notification_delivery_rule_admin_update ON "NotificationDeliveryRule"
  FOR UPDATE
  USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());

GRANT SELECT, INSERT, UPDATE ON "NotificationDeliveryRule"
  TO service_platform_app;
