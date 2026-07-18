ALTER TABLE "ProjectPluginBinding"
  ADD COLUMN "externalConnectorSlot" TEXT;

UPDATE "ProjectPluginBinding"
SET "externalConnectorSlot" = 'PRIMARY'
WHERE "pluginKey" IN ('sub2api-connector', 'universal-embed-connector');

ALTER TABLE "ProjectPluginBinding"
  ADD CONSTRAINT "ProjectPluginBinding_external_connector_slot_check"
  CHECK (
    "externalConnectorSlot" IS NULL
    OR "externalConnectorSlot" = 'PRIMARY'
  );

CREATE UNIQUE INDEX "ProjectPluginBinding_projectId_externalConnectorSlot_key"
  ON "ProjectPluginBinding"("projectId", "externalConnectorSlot");

ALTER TABLE "ExternalContact"
  ADD COLUMN "lastParentOrigin" TEXT;

CREATE INDEX "UniversalLaunchTicket_bindingId_createdAt_idx"
  ON "UniversalLaunchTicket"("bindingId", "createdAt");
