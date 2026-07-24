UPDATE "RoleGroup"
SET "permissions" = array_append("permissions", 'update.comment'),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'project_manager'
  AND NOT ('update.comment' = ANY("permissions"));
