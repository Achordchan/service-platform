ALTER TABLE "RequestMessage"
ADD COLUMN "supportPlaybookKey" TEXT,
ADD COLUMN "supportPlaybookSnapshot" JSONB;

ALTER TABLE "RequestMessage"
ADD CONSTRAINT "RequestMessage_support_playbook_pair_check"
CHECK (
  ("supportPlaybookKey" IS NULL AND "supportPlaybookSnapshot" IS NULL)
  OR
  ("supportPlaybookKey" IS NOT NULL AND "supportPlaybookSnapshot" IS NOT NULL)
);
