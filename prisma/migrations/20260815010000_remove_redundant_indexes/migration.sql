DROP INDEX IF EXISTS "UserNotificationPreference_userId_idx";

DROP INDEX IF EXISTS "AuditLog_result_idx";

-- Most rows are successful. Index only exceptional outcomes used by failure
-- investigations instead of paying the write cost for every success row.
CREATE INDEX IF NOT EXISTS "AuditLog_non_success_result_idx"
  ON "AuditLog" ("result")
  WHERE "result" <> 'SUCCESS';
