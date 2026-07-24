ALTER TABLE "Notification"
  ADD COLUMN "sourceType" TEXT,
  ADD COLUMN "sourceId" TEXT;

CREATE INDEX "Notification_sourceType_sourceId_idx"
  ON "Notification"("sourceType", "sourceId");
