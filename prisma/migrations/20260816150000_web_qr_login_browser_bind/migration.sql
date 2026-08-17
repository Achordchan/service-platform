-- 扫码登录票据绑定创建它的浏览器（防登录 CSRF / 会话置换）：
-- 攻击者用自己的账号确认票据后，诱导受害者打开完整轮询 URL，
-- 即可把自己的会话 cookie 写入受害者浏览器。POST 创建票据时签发
-- HttpOnly 绑定 cookie（票据侧只存哈希），轮询/小程序码请求必须匹配。
-- 可空列：迁移前已存在的票据与直接服务层调用（集成测试）不受影响，5 分钟自然过期。

ALTER TABLE "WebQrLoginTicket" ADD COLUMN "bindHash" TEXT;

-- 「已消费票据的一次性重签」标记：轮询响应丢失/重叠轮询时允许重新代签
-- 恰好一次，防止 60 秒窗口内脚本化轮询批量铸造 Session（幂等性 + 防资源放大）。
ALTER TABLE "WebQrLoginTicket" ADD COLUMN "reissuedAt" TIMESTAMP(3);
