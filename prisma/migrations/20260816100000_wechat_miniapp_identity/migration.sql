-- 微信小程序身份与绑定基础设施。
-- 与 "Session"/"Account"/"Verification" 同属认证基础设施：不启用 RLS（登录流程发生
-- 在形成用户 Actor 之前，无法按用户隔离），全部访问控制由 miniapp 服务层完成，
-- 服务层仅允许通过 openid/token 哈希等不可猜测的凭据定位记录。

CREATE TABLE "WechatBinding" (
  id TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  openid TEXT NOT NULL,
  unionid TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "lastLoginAt" TIMESTAMP(3),
  CONSTRAINT "WechatBinding_pkey" PRIMARY KEY (id),
  CONSTRAINT "WechatBinding_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WechatBinding_userId_key" ON "WechatBinding"("userId");
CREATE UNIQUE INDEX "WechatBinding_openid_key" ON "WechatBinding"(openid);
CREATE INDEX "WechatBinding_userId_idx" ON "WechatBinding"("userId");

CREATE TABLE "WechatBindingCode" (
  id TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "usedByOpenid" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WechatBindingCode_pkey" PRIMARY KEY (id),
  CONSTRAINT "WechatBindingCode_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WechatBindingCode_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WechatBindingCode_codeHash_key" ON "WechatBindingCode"("codeHash");
CREATE INDEX "WechatBindingCode_userId_createdAt_idx"
  ON "WechatBindingCode"("userId", "createdAt");

CREATE TABLE "MiniappSession" (
  id TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3),
  CONSTRAINT "MiniappSession_pkey" PRIMARY KEY (id),
  CONSTRAINT "MiniappSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MiniappSession_tokenHash_key" ON "MiniappSession"("tokenHash");
CREATE INDEX "MiniappSession_userId_expiresAt_idx"
  ON "MiniappSession"("userId", "expiresAt");

CREATE TABLE "MiniappAuthTicket" (
  id TEXT NOT NULL,
  "ticketHash" TEXT NOT NULL,
  openid TEXT NOT NULL,
  unionid TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "otpSentCount" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "MiniappAuthTicket_pkey" PRIMARY KEY (id)
);
CREATE UNIQUE INDEX "MiniappAuthTicket_ticketHash_key" ON "MiniappAuthTicket"("ticketHash");
CREATE INDEX "MiniappAuthTicket_openid_createdAt_idx"
  ON "MiniappAuthTicket"(openid, "createdAt");

CREATE TABLE "WechatBindGuard" (
  openid TEXT NOT NULL,
  "failCount" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WechatBindGuard_pkey" PRIMARY KEY (openid)
);

CREATE TABLE "WechatSubscribeGrant" (
  id TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "templateKey" TEXT NOT NULL,
  remaining INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "lastReportedAt" TIMESTAMP(3),
  CONSTRAINT "WechatSubscribeGrant_pkey" PRIMARY KEY (id),
  CONSTRAINT "WechatSubscribeGrant_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WechatSubscribeGrant_userId_templateKey_key"
  ON "WechatSubscribeGrant"("userId", "templateKey");

GRANT SELECT, INSERT, UPDATE, DELETE ON "WechatBinding" TO service_platform_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "WechatBindingCode" TO service_platform_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "MiniappSession" TO service_platform_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "MiniappAuthTicket" TO service_platform_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "WechatBindGuard" TO service_platform_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "WechatSubscribeGrant" TO service_platform_app;
