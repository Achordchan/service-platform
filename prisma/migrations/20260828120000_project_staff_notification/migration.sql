-- 项目人员变动通知：被加入项目、项目角色调整、被移出项目时通知当事人。
-- PG 12+ 允许在事务内 ADD VALUE，只要同一事务里不使用该值；本迁移不使用。
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PROJECT_STAFF';
