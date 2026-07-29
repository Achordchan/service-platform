-- Manual service request assignment is reserved for platform administrators.
-- Remove the retired permission from existing role groups so it no longer
-- appears in stored role configuration or actor permission snapshots.
UPDATE "RoleGroup"
SET
  "permissions" = array_remove("permissions", 'request.assign'),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE 'request.assign' = ANY("permissions");

UPDATE "RoleGroup"
SET
  "description" = '管理授权项目的交付进度、里程碑和服务请求处理。',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'project_manager'
  AND "description" = '管理授权项目的交付进度、里程碑和服务请求分配。';
