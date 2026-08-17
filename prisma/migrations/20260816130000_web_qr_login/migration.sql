-- 网页版扫码登录票据（Web 二维码 <-> 小程序确认 <-> better-auth 会话交换）
CREATE TABLE "WebQrLoginTicket" (
  id TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  "userId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebQrLoginTicket_pkey" PRIMARY KEY (id),
  CONSTRAINT "WebQrLoginTicket_status_check"
    CHECK (status IN ('PENDING', 'CONFIRMED', 'CONSUMED', 'EXPIRED'))
);

CREATE UNIQUE INDEX "WebQrLoginTicket_tokenHash_key" ON "WebQrLoginTicket"("tokenHash");
CREATE INDEX "WebQrLoginTicket_status_createdAt_idx" ON "WebQrLoginTicket"(status, "createdAt");

GRANT SELECT, INSERT, UPDATE, DELETE ON "WebQrLoginTicket" TO service_platform_app;
