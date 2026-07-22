UPDATE "Project"
SET status = 'ACTIVE', "updatedAt" = NOW()
WHERE kind = 'STANDARD' AND status = 'DRAFT';

ALTER TABLE "Project" ALTER COLUMN status SET DEFAULT 'ACTIVE';
