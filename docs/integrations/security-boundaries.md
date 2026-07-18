# Achord Connect 安全与产品边界

## 身份边界

- 第三方系统负责自己的登录；Achord 只信任持有 Client Secret 的第三方后端签发的 60 秒单次票据。
- Client Secret 禁止进入浏览器、移动端包、iframe URL、日志和前端环境变量。
- 外部用户以 `连接 + external user id` 为稳定身份，不创建 Better Auth 用户、Membership 或密码；external user id 只能按字符串传输，禁止使用 JSON number 表示 64 位 ID。
- 相同邮箱的正式用户和外部联系人不自动合并。

## 数据边界

- 外部用户只能读取自己创建的工单、公开消息和公开附件。
- 外部用户不能访问客户空间、项目动态、里程碑、项目文件、成员、通知中心和其他联系人。
- Webhook 不发送内部备注、后台隐私资料、附件字节、凭据、票据或 Embed Session。
- 一个连接固定绑定一个项目；票据和会话不能跨连接或跨项目复用。

## 浏览器边界

- iframe 不依赖第三方 Cookie；票据通过 URL fragment 传递，兑换后立即清理。
- 后续请求使用 `Authorization: Embed <session-token>`；SSE Token 不进入 URL。
- CSP `frame-ancestors` 只使用后台保存的 HTTPS Origin。
- `postMessage` 只发送 `ready`、`height`、`unread-changed`、`session-expired`，并固定目标 Origin。
- 多 Origin 连接由第三方后端在签票时提交允许列表内的 `context.returnOrigin`，浏览器检测到的父 Origin 只能做一致性校验，不能覆盖该可信来源。
- Universal 票据兑换必须取得真实父页面 Origin，并与 `context.returnOrigin` 完全一致；无法取得父来源时直接拒绝兑换。宿主不得通过 `referrerpolicy="no-referrer"` 隐藏 iframe 来源。

## 网络边界

- 创建票据和通用票据兑换接口的 JSON 请求体在应用与 Nginx 两层限制为 64KB；签票接口先验证 Basic Auth，再读取正文。
- 生产 Nginx 的 HTTPS `server {}` 必须 include `scripts/nginx-universal-request-body-limits.conf`；部署脚本会在停止应用前验证两个精确 location 已生效。
- 首次发布该防护时，GitHub Actions 会先将本次 release 中的 `remote-deploy.sh` 安装为 canonical deploy script，再执行 Nginx 预检。VPS 必须提前在 `support.achord.cn` HTTPS `server {}` 启用上述 include；缺失时部署在停服务和清理依赖前失败。
- Webhook 仅允许 HTTPS；开发环境可显式使用 localhost HTTP。
- 每次投递重新解析 DNS，任一解析结果为本机、内网、链路本地或保留地址时拒绝。
- 请求固定到已校验 IP，TLS SNI 和 Host 保持原域名；不跟随重定向。
- 单次请求超时 5 秒，响应最多读取 64KB。

## 生命周期边界

- 插件停用、连接停用或归档会撤销现有 Embed Session，阻止新票据和后续 Webhook 业务投递。
- 归档不会删除外部联系人、工单、消息、附件或审计历史。
- v1 只提供完整 iframe 门户，不承诺 Headless 工单 API、跨项目连接、正式账号合并或客户门户整体嵌入。
