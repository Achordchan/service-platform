-- CreateEnum
CREATE TYPE "RoleAccessLevel" AS ENUM ('PROJECT_MANAGER', 'TECHNICIAN');

-- AlterTable User profile
ALTER TABLE "User"
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "company" TEXT,
  ADD COLUMN "jobTitle" TEXT,
  ADD COLUMN "wechat" TEXT,
  ADD COLUMN "website" TEXT,
  ADD COLUMN "location" TEXT,
  ADD COLUMN "contactNotes" TEXT,
  ADD COLUMN "roleGroupId" TEXT;

-- AlterTable StaffInvitation profile
ALTER TABLE "StaffInvitation"
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "company" TEXT,
  ADD COLUMN "jobTitle" TEXT,
  ADD COLUMN "wechat" TEXT,
  ADD COLUMN "website" TEXT,
  ADD COLUMN "location" TEXT,
  ADD COLUMN "contactNotes" TEXT,
  ADD COLUMN "roleGroupId" TEXT;

-- CreateTable RoleGroup
CREATE TABLE "RoleGroup" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "accessLevel" "RoleAccessLevel" NOT NULL,
    "permissions" TEXT[],
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RoleGroup_key_key" ON "RoleGroup"("key");
CREATE INDEX "RoleGroup_active_sortOrder_idx" ON "RoleGroup"("active", "sortOrder");
CREATE INDEX "User_roleGroupId_idx" ON "User"("roleGroupId");
CREATE INDEX "StaffInvitation_roleGroupId_idx" ON "StaffInvitation"("roleGroupId");

ALTER TABLE "User"
  ADD CONSTRAINT "User_roleGroupId_fkey"
  FOREIGN KEY ("roleGroupId") REFERENCES "RoleGroup"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StaffInvitation"
  ADD CONSTRAINT "StaffInvitation_roleGroupId_fkey"
  FOREIGN KEY ("roleGroupId") REFERENCES "RoleGroup"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed default role groups
INSERT INTO "RoleGroup" ("id", "key", "name", "description", "accessLevel", "permissions", "isSystem", "active", "sortOrder", "createdAt", "updatedAt")
VALUES
  (
    'rg_project_manager',
    'project_manager',
    '项目负责人',
    '管理授权项目的交付进度、里程碑和服务请求分配。',
    'PROJECT_MANAGER',
    ARRAY[
      'project.view',
      'project.manage_delivery',
      'project.manage_staff',
      'request.view_project',
      'request.assign',
      'request.reply',
      'request.change_status',
      'file.upload',
      'update.publish'
    ],
    true,
    true,
    10,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'rg_technician',
    'technician',
    '技术人员',
    '处理分配给自己的服务请求，查看授权项目公共信息。',
    'TECHNICIAN',
    ARRAY[
      'project.view',
      'request.view_assigned',
      'request.reply',
      'request.change_status',
      'file.upload'
    ],
    true,
    true,
    20,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'rg_seo_specialist',
    'seo_specialist',
    'SEO 外包专员',
    '面向 SEO 外包协作，默认可处理分配请求并查看项目进度。',
    'TECHNICIAN',
    ARRAY[
      'project.view',
      'request.view_assigned',
      'request.reply',
      'request.change_status',
      'file.upload',
      'update.comment'
    ],
    false,
    true,
    30,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'rg_api_support',
    'api_support',
    'API 运维支持',
    '面向 API 中转/运维外包，默认处理分配请求。',
    'TECHNICIAN',
    ARRAY[
      'project.view',
      'request.view_assigned',
      'request.reply',
      'request.change_status',
      'file.upload'
    ],
    false,
    true,
    40,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  );

-- Bind existing staff users to system groups
UPDATE "User" u
SET "roleGroupId" = rg.id
FROM "RoleGroup" rg
WHERE u."platformRole" = 'PROJECT_MANAGER'
  AND rg."key" = 'project_manager';

UPDATE "User" u
SET "roleGroupId" = rg.id
FROM "RoleGroup" rg
WHERE u."platformRole" = 'TECHNICIAN'
  AND rg."key" = 'technician';

ALTER TABLE "RoleGroup" ENABLE ROW LEVEL SECURITY;
CREATE POLICY role_group_admin_all ON "RoleGroup"
  FOR ALL
  USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());
CREATE POLICY role_group_staff_read ON "RoleGroup"
  FOR SELECT
  USING (app_is_staff());

GRANT SELECT, INSERT, UPDATE, DELETE ON "RoleGroup" TO service_platform_app;
