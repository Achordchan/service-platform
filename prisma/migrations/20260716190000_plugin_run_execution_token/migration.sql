ALTER TABLE "PluginRun"
  ADD COLUMN "executionToken" TEXT;

CREATE INDEX "PluginRun_executionToken_idx"
  ON "PluginRun"("executionToken");
