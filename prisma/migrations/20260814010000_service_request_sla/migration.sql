ALTER TABLE "ServiceType"
  ADD COLUMN "slaResponseMinutes" INTEGER,
  ADD COLUMN "slaResolutionMinutes" INTEGER;

ALTER TABLE "ServiceRequest"
  ADD COLUMN "firstRespondedAt" TIMESTAMP(3),
  ADD COLUMN "dueAt" TIMESTAMP(3);

CREATE INDEX "ServiceRequest_dueAt_idx" ON "ServiceRequest"("dueAt");
