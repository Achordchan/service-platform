-- Project feature flags for milestones / progress display
ALTER TABLE "Project"
  ADD COLUMN IF NOT EXISTS "showMilestones" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Project"
  ADD COLUMN IF NOT EXISTS "showProgress" BOOLEAN NOT NULL DEFAULT true;
