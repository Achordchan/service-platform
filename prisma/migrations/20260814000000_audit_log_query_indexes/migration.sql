-- Support the audit-log viewer's time-range filter and default ordering.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "AuditLog_createdAt_idx"
  ON "AuditLog" ("createdAt" DESC);

-- Support the facet aggregation queries (groupBy action / resourceType / result).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "AuditLog_action_idx"
  ON "AuditLog" ("action");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "AuditLog_resourceType_idx"
  ON "AuditLog" ("resourceType");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "AuditLog_result_idx"
  ON "AuditLog" ("result");
