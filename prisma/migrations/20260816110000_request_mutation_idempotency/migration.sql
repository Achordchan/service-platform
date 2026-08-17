-- 小程序工单创建/回复幂等：客户端在弱网重试时携带 X-Idempotency-Key，
-- 服务层事务内按 (作者, key) 查重命中即返回已有记录，唯一约束兜底并发。
-- 两者均为可空列：Web 端不携带 key（NULL）时 Postgres 默认 NULLS DISTINCT，不参与唯一冲突。

ALTER TABLE "ServiceRequest"
  ADD COLUMN "clientMutationKey" TEXT;

CREATE UNIQUE INDEX "ServiceRequest_createdById_clientMutationKey_key"
  ON "ServiceRequest"("createdById", "clientMutationKey");

ALTER TABLE "RequestMessage"
  ADD COLUMN "clientMutationKey" TEXT;

CREATE UNIQUE INDEX "RequestMessage_authorId_clientMutationKey_key"
  ON "RequestMessage"("authorId", "clientMutationKey");
