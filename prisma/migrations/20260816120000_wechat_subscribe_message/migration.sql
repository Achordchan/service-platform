-- 微信小程序订阅消息（阶段 3）：
-- 1) 通知投递规则增加 wechat 渠道开关（仿 dingtalkEnabled，默认关闭）
-- 2) 订阅消息投递 outbox 表（PENDING → PROCESSING → DELIVERED/FAILED/SKIPPED）

ALTER TABLE "NotificationDeliveryRule"
  ADD COLUMN "wechatEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "WechatSubscribeMessageDelivery" (
  id TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "templateKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "requestId" TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  page TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3),
  "lastError" TEXT,
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WechatSubscribeMessageDelivery_pkey" PRIMARY KEY (id),
  CONSTRAINT "WechatSubscribeMessageDelivery_status_check"
    CHECK (status IN ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED', 'SKIPPED'))
);

CREATE UNIQUE INDEX "WechatSubscribeMessageDelivery_eventKey_key"
  ON "WechatSubscribeMessageDelivery"("eventKey");
CREATE INDEX "WechatSubscribeMessageDelivery_status_nextAttemptAt_idx"
  ON "WechatSubscribeMessageDelivery"(status, "nextAttemptAt");
CREATE INDEX "WechatSubscribeMessageDelivery_userId_createdAt_idx"
  ON "WechatSubscribeMessageDelivery"("userId", "createdAt");

GRANT SELECT, INSERT, UPDATE, DELETE ON "WechatSubscribeMessageDelivery"
  TO service_platform_app;
