-- Per-type email notification preferences for individual users.
-- When a row exists the user has explicitly opted out (or back in) for that
-- notification rule key.  Missing rows default to emailEnabled = true (opt-out
-- model), and the user's master switch `requestEmailNotificationsEnabled`
-- remains the top-level gate.

CREATE TABLE "UserNotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserNotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserNotificationPreference_userId_ruleKey_key"
  ON "UserNotificationPreference"("userId", "ruleKey");

CREATE INDEX "UserNotificationPreference_userId_idx"
  ON "UserNotificationPreference"("userId");

ALTER TABLE "UserNotificationPreference"
  ADD CONSTRAINT "UserNotificationPreference_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: users can only read/write their own preference rows.
ALTER TABLE "UserNotificationPreference" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_notification_preference_own"
  ON "UserNotificationPreference"
  FOR ALL
  USING (current_setting('app.user_id', true) = "userId")
  WITH CHECK (current_setting('app.user_id', true) = "userId");

-- Platform admins can read all rows (for support/debugging).
CREATE POLICY "user_notification_preference_admin_read"
  ON "UserNotificationPreference"
  FOR SELECT
  USING (app_is_platform_admin());

GRANT SELECT, INSERT, UPDATE, DELETE
  ON "UserNotificationPreference"
  TO service_platform_app;
