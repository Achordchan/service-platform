# 微信小程序 V1 技术方案

**依据：`service-platform-wechat-miniapp-prd.md`（V1.0）**
**阶段：阶段 0-4 开发完成（含阶段 3 复核修复与视觉打磨），待真机验收**
**日期：2026-08-16**

---

## 0. 实施状态

### 网页版扫码登录（个人主体适配：小程序码方案）

- **平台限制记录**：「扫普通链接二维码打开小程序」仅企业等非个人主体可配置；微信开放平台网站应用需企业认证。当前小程序为个人主体，两条官方通道均不可用。
- **采用方案**：**小程序码（wxacode.getUnlimited）**——个人主体可用，微信扫一扫/长按识别直达小程序确认页。二维码内容 scene=`t=<26字符token>`，页面 `pages/web-login/page`（check_path=false，发布前后均生成成功需 env_version 匹配线上）。
- **单通道约束**：小程序码是唯一扫码形态（`spqr:` 协议、URL 中转页 `/qr-login`、小程序内 wx.scanCode 入口均已删除，防并存）。接口不可用（dev Provider / 未配置凭据 / 页面未发布）时登录页展示占位说明而非降级码。token 为 26 字符（scene ≤32 限制）。
- **前置条件（发布时）**：小程序正式发布 + `.env` 配 `WECHAT_MINIAPP_APPID/APP_SECRET`（real Provider）即可，无需任何后台跳转规则。

### 实时化升级：小程序接入 SSE（已实施）

工单对话从「15s 轮询」升级为**秒级实时**，与 Web 完全同一套事件源：

- **后端**：SSE 核心逻辑抽取为 `src/modules/notifications/event-stream-handler.ts`（LISTEN 唤醒 + EventRecord 游标回放 + 25s 心跳 + transient 正在输入），Web `/api/v1/notifications/stream` 改为薄壳；新增 `GET /api/miniapp/events/stream`（统一 `requireApiActor`，Bearer 优先，支持 `Last-Event-ID` 断线续传）——两端行为字面一致。
- **小程序**：`lib/sse.ts` 用 `wx.request enableChunked` 分块解析 `text/event-stream`（字节级分帧器处理跨 chunk 的 UTF-8 多字节截断与 `\r\n` 行尾，手写 UTF-8 解码器替代缺失的 TextDecoder）。`events.ts` 为**纯 SSE 单通道**（按约束不设轮询兜底）：断开按指数退避（1s→30s 封顶）自动重连，网络恢复 `wake()` 清退避立即重连，`Last-Event-ID` + storage 游标保证断线不丢事件（服务端先回放再 READY）；页面引用计数归零才断流。
- **验证**：解析器单测 4 个（含跨 chunk 中文截断）；真实服务冒烟——Bearer 挂流收到事件帧、无凭据 401；回归 418/419（baseline）、集成 154/154。

### 总 Review 修复（P0×1 + P1×6 + P2×7，全部落实）

- **P0 纯附件回复**：对齐 Web 端 `buildAttachmentOnlyMessage`——无文本时正文写「附件：文件名列表」，回复成功后附件挂到消息（原实现 body 为 `<p></p>`，服务端 `EMPTY_MESSAGE` 100% 拒绝且附件从未上传）。
- **P1 成员管理越权读取**：小程序改走 `GET /api/miniapp/space/members`（新 `space-members-service`，显式 Owner/Admin 校验，不再暴露 emailChanges/邀请人邮箱）；写操作直接复用 `customer-member-service`（自带校验）。集成测试：非 Owner 成员 403、Owner 正常。原 `/api/v1/admin/customer-spaces/:id` 的 getCustomerSpace 越权面保持不动（供 Web 后台使用，未加断言以免误伤员工端）。
- **P1 eventSync 引用计数**：`start()/stop()` 计数化，消息 tab 与工单详情叠加时后退页的 stop 不再清掉前进页的定时器。
- **P1 附件 401**：upload/download 的 401 统一清登录态并回登录页（与 request.ts 一致）。
- **P1 密码绑定按邮箱限流**：`WechatBindGuard` 以 `email:<addr>` 伪键复用同一计数/锁定逻辑（零迁移），5 次失败锁 10 分钟，换微信号无法绕过（集成测试覆盖）。
- **P1 lint 清零**：存量 7 处（4 文件）全部修复或显式豁免（初始加载模式的同步 setState 属请求路径必需，注明理由），`eslint .` 全绿。
- **P1 多空间**：「我的」成员管理入口对多个 Owner 空间弹出选择。
- **P2 全部**：回复/描述 maxlength 留 HTML 膨胀余量（15000）；里程碑/动态 loaded 标志（空结果不重复拉、下拉刷新重置）；项目详情视图类型诚实化（ProjectDetailView）；删重复 formatSize 与死代码 lastErrorAt；OTP 60s 倒计时（服务端冷却静默、客户端显性）；订阅消息 DELIVERED+扣额度合并单事务。

### 阶段 4（复核修复 + 打磨，开发完成）

阶段 3 复核意见全部落实：

必修：
1. 幂等键父资源不一致改抛 409 `IDEMPOTENCY_KEY_CONFLICT`（report 与代码对齐）。
2. 订阅消息入队改 `createMany + skipDuplicates`（数据库层 ON CONFLICT DO NOTHING，事务不再有 aborted 风险），`count > 0` 才 pg_notify——「入队失败不影响业务」现在有真正的保证。
3. worker 增加 PROCESSING 僵尸回收（`WECHAT_PROCESSING_CLAIM_STALE_MS = 15min`，同邮件 outbox 模式；due/claim 条件同步放宽），集成测试覆盖「卡死投递被重新捞起并投递成功」。
4. `config.ts` 异常兜底指向 PROD（develop 才显式判定），消除正式版探测异常时指向 localhost 的发版事故风险。

应修：members 页 403 判断改用 `ApiError.status`（原 message.includes 为死代码）；模板 ID 下发接口 `GET /api/miniapp/subscribe-message/config`（单一配置源=服务端 env，小程序无需发版）；TabBar 未读角标统一模块 `lib/badge.ts`（四个 Tab onShow + NOTIFICATION_CREATED 事件回调统一走 /summary，单条已读即时刷新数字）；`saveToken` 内 `eventSync.reset()`（覆盖 401 被踢后换号场景）；members 缺 spaceId 显示错误态而非永久 loading。

可延后（顺手修复）：微信响应仅 `errcode === 0` 判 SENT（HTML 错误页不再误扣额度）；thing 字段截 20 字带省略号并清洗换行；`.env.example` 补 3 个模板 ID。

视觉打磨（PRD §26/§27/§35）：
- 全局 token 升级：品牌渐变、三级文字色、卡片阴影、间距节奏（4 倍数）、字体栈；统一 `tag-*` 状态色体系（项目/工单状态、优先级各有 tone 映射）。
- 共享状态组件 `components/states.wxml`：骨架屏（呼吸动画 skeleton）、空状态（图标+标题+副文案）、错误态（可重试 / 无权🔒 / 离线变体）——所有列表页与详情页统一替换「加载中…」文字。
- 逐页视觉：登录页品牌渐变背景+徽章光影；项目卡片按压反馈（hover-class 缩放）；项目详情渐变 hero + 吸顶 Tab + 纵向里程碑 Timeline（轨道连线）；工单列表筛选 chips 动效 + 渐变 FAB；工单详情对话气泡方向化圆角（己方蓝底渐变）+ 引用块品牌色 + 输入栏质感；我的页字母头像渐变徽章 + 入口箭头。

### 阶段 3（消息中心 + 微信订阅消息 + 我的/成员）已完成

必修：
1. 事件回调 this 绑定（onLoad bind 后注册/注销），events.ts 监听异常输出 console.error、401 清登录态回登录页。
2. 绑定 OTP 防枚举/防轰炸：sendBindingOtp 一律返回 `{sent:true}`（邮箱不存在/已绑定/冷却/超限不再区分）；失败计入 WechatBindGuard；按邮箱 60s 冷却（查 Verification 表 identifier 索引）。

应修：isMine 改用当前用户 id（fetchMeCached）；登出清事件游标（eventSync.reset）；网络监听注册不依赖登录态；config 按 envVersion 切换 API 地址 + `.env.example` 补 4 个微信变量。

> ⚠️ 上条的「config 按 envVersion 切换 API 地址」已于 2026-08-30 推翻（PR #18），勿再照做：
> 微信「审核版」的 `envVersion` 返回 `develop` 而非 `trial`，据此切到本地地址会让审核员在真机上
> 把请求打到 127.0.0.1，登录必然失败，已因此按《运营规范》3.3「功能报错」被驳回。
> 现按运行平台判断——`platform === "devtools"` 才连本地，真机（预览/体验版/审核版/正式版）
> 一律走生产，见 `miniapp/src/lib/api-base-url.ts`。

可延后（已顺手修复）：富文本拼接前 escapeHtml；幂等键命中后校验父资源一致（不一致 409 IDEMPOTENCY_KEY_CONFLICT）；锁定触发时 failCount 归零；每日 `miniapp-identity-sweep` 清理过期票据/计数/会话。

### 阶段 3（消息中心 + 微信订阅消息 + 我的/成员）已完成

- **通知 Bearer 化**：`GET/PATCH /api/v1/notifications`、`GET /api/v1/notifications/summary` 改用统一 `requireApiActor`（原 requireUserWithAccess 会 302，小程序不可用）；Web 行为不变（无 Authorization 头走 Cookie）。
- **订阅消息链路**（migration `20260816120000`）：`NotificationDeliveryRule.wechatEnabled`（默认关）+ `WechatSubscribeMessageDelivery` outbox 表。挂点在 `createNotification`（同事务）：类型映射（REQUEST_MESSAGE→REQUEST_REPLY、REQUEST_STATUS→REQUEST_STATUS、PROJECT_UPDATE→PROJECT_UPDATE）→ 规则开启 + 已绑定 + 额度>0 才入队，`pg_notify` 唤醒 + 每分钟 sweep 兜底；worker 原子 claim → 复查前置 → 发送（real: access_token 缓存 + subscribe/send；dev: 空操作）→ 成功扣额度、43101 清零 SKIPPED、40003/40037 FATAL、其余按 60s/5m/30m 重试。**入队/发送任何失败均不影响业务**。
- **授权上报**：`POST /api/miniapp/subscribe-message/grants`（accept-only）；60s 节流 + 额度封顶 30，仅作状态，真实额度按微信发送结果修正。
- **小程序**：消息中心 Tab（列表/分页/全部已读/点击已读+跳转工单或项目/TabBar 未读角标/事件驱动刷新）；通知设置页（提示音、邮件偏好——复用 `/api/v1/me/notification-preferences`，微信提醒授权引导，正式模板 ID 就绪前占位提示）；成员管理页（Owner：列表/邮件邀请/移除，复用 admin 路由）+「我的」入口。
- **环境变量**：`WECHAT_TEMPLATE_{REQUEST_REPLY,REQUEST_STATUS,PROJECT_UPDATE}_ID`（正式模板审批后配置；未配置时投递 SKIPPED 不报错）。
- 集成测试 4 个：类型映射、规则开关+绑定+额度的入队矩阵、SENT→DELIVERED+扣减 / 43101→SKIPPED+清零 / 无额度不入队、上报节流。阶段 3 回归：单元 414/415（baseline）、集成 151/151。

### 阶段 2（项目与工单模块 + EventRecord 增量同步）已完成

- **复用**：小程序直接调用现有 `/api/v1/projects`、`/api/v1/projects/[id]`、`.../milestones`、`.../updates`、`/api/v1/requests/[id]`、`POST .../requests`、`POST .../messages`、`GET/POST /api/v1/attachments`（Bearer），业务规则/RLS/项目开关与 Web 完全一致，零业务重实现。
- **新增**（均为薄壳，不复写业务）：
  - `GET /api/v1/requests`（跨项目工单列表：projectId/status/q 筛选 + limit/offset 分页，`listRequestsForActor` 沿用 RLS 可见项目 + customerRequestsEnabled 门控 + 员工 assigned 限制语义）；
  - `GET /api/miniapp/events?after=&limit=`（`event-sync-service.listMiniappEvents` 直接复用 Web SSE 的 `listVisibleEventBatch` 可见性过滤，返回 `{events, cursor, hasMore}`）。
- **幂等**（migration `20260816110000_request_mutation_idempotency`）：`ServiceRequest.clientMutationKey`（`@@unique([createdById, clientMutationKey])`）与 `RequestMessage.clientMutationKey`（`@@unique([authorId, clientMutationKey])`），均可空——Web 不传 key 时 NULL 不参与唯一冲突，行为不变。服务层事务开头按 `(作者, key)` 查重命中即返回已有记录，唯一约束兜底并发（P2002 → 重查返回）。路由从 `X-Idempotency-Key` 头注入。小程序端：进入新建页/每次回复生成 UUID key，失败重试复用同一 key。
- **小程序页面**：项目列表（下拉刷新/进度条）、项目详情五模块（Tab 按项目开关门控：概览/里程碑 Timeline/动态(含评论)/服务请求入口/文件说明）、工单列表（项目+状态筛选/关键词搜索/下拉刷新/加载更多/FAB 新建）、新建工单（项目→分类级联/优先级/附件选择，幂等提交）、工单详情（信息卡+对话消息流+引用回复(长按)+图片全屏预览+文件 wx.openDocument+底部回复栏含附件）。
- **事件同步**：`miniapp/src/lib/events.ts` 单例管理器——游标持久化 storage、工单详情页 onShow `start()`（15s 轮询 + 立即拉取）、onHide `stop()`、`wx.onNetworkStatusChange` 恢复即补拉、按 requestId+事件类型过滤后自动刷新页面。
- **集成测试**（`tests/integration/miniapp-requests-events.integration.ts`，真实 PG 双 CustomerSpace）：创建/回复幂等（同 key 同记录、不同 key 新记录、无 key 不受影响）、横向越权（A 读 B 的项目/工单/回复/附件全部被拒、跨项目列表与项目筛选隔离、events 按 Actor 隔离且游标增量正确、附件上传者可读而对方 404）。
- 阶段 2 回归：单元 414/415（唯一失败为 baseline known issue）、集成 147/147。

### 阶段 0 + 1（已完成）

已确认并落实的方案调整：

1. **Bearer 与 Cookie 严格优先级**：携带 `Authorization` 头时只验证 Bearer，失败直接 401，**绝不回落 Cookie**；两处重复的 `requireApiActor()` 已收口到统一入口 `src/modules/http/api-actor.ts`（`resolveApiActor()`），92 个既有路由零改动继承新行为。
2. **解绑即删除**：`WechatBinding` 只表示当前有效绑定（无 status 字段），解绑时同事务删除绑定 + 撤销全部 MiniappSession，历史经 `AuditLog`（`WECHAT_BINDING_REMOVED`）留存，openid/userId 唯一键随之释放，可重新绑定其他账号（集成测试已覆盖）。
3. **双通道账号验证**：绑定方式一同时支持邮箱密码与 Email OTP（服务端复用 better-auth `signInEmail` / `sendVerificationOTP + signInEmailOTP`，验证通过立即删除临时 Web Session，**无任何 bcrypt 直读 fallback**）；无密码客户可绑定（集成测试已覆盖）。
4. **订阅消息额度仅作状态**（阶段 3 落地）：`WechatSubscribeGrant` 表已建，客户端上报只更新剩余额度状态，不作为权限凭证；后续按微信实际发送结果修正额度并做防重复上报与限流。
5. **Provider 可替换**：`MINIAPP_WECHAT_PROVIDER=real|dev`；dev Provider（固定测试 openid）在 `NODE_ENV=production` 下构造即抛错，**生产强制真实微信凭据**；real 未配置凭据时调用期返回 503 明确错误（不影响纯 Web 部署启动）。

新增数据结构（migration `20260816100000_wechat_miniapp_identity`，认证基础设施表不启用 RLS，与 Session/Account 同类）：
`WechatBinding`（openid/userId 双向 unique）、`WechatBindingCode`（hash 存储、单次、可撤销）、`MiniappSession`（tokenHash）、`MiniappAuthTicket`（待绑定票据）、`WechatBindGuard`（防暴力锁定）、`WechatSubscribeGrant`（额度状态）。

新增接口：`POST/DELETE /api/miniapp/auth/session`、`POST /api/miniapp/auth/bind/account|code|otp/send`、`GET /api/miniapp/me`；员工端 `.../members/[membershipId]/wechat-binding`（GET/DELETE）与 `.../binding-codes`（POST、DELETE [codeId]）。

测试：单测 13 个（token/绑定码格式、Provider 生产防护、Bearer 优先级语义）；集成测试 9 个（绑定码单次/过期/作废、密码绑定不留存 Web Session、双向唯一、防暴力锁定、无密码 OTP 绑定、解绑后 Session 失效并可重绑、hash 入库、非 Owner 越权 403）。全量回归：单元 414/415、集成 140/140 通过（唯一失败为会话开始前工作树已有的 `customer-service-request-grid` 存量问题，与本次无关）。

实施中发现并修复的问题：
- `getMiniappMe` 最初用普通 Prisma 查询 `Membership`（RLS 保护表），未设置 `app.user_id` 时查询结果为空——已改为 `withActorDb`（这正是集成测试存在的价值：RLS 行为只有真库才能暴露）。
- 测试 SQL 经验：本项目所有 Prisma `DateTime` 列均为 `TIMESTAMP(3)` 无时区、全链路按 UTC 墙钟读写；外部 SQL 直接写这些列时必须用 `NOW() AT TIME ZONE 'utc'`，否则按服务器会话时区写入导致 +8h 漂移。

---

## 1. 对现有客户侧功能的理解

现有系统是 pnpm monorepo 的 Next.js 16（App Router）+ React 19 + Prisma 7（PostgreSQL，含数据库级 RLS）+ better-auth + MUI v9 的服务支持中心。客户侧 Web 位于 `src/app/(customer)/customer/`，页面为 Server Component，经 `requireUserWithAccess()`（`src/lib/session.ts`）取得 Actor 后**直接调用领域 Service**，不走内部 HTTP。

| 模块 | 现有能力 | 关键 Service |
|---|---|---|
| 项目列表/详情 | 概览、里程碑（时间线）、项目动态（含评论）、服务请求、文件 5 个 Tab；Tab 由项目开关门控（`showMilestones` / `customerUpdatesEnabled` / `customerRequestsEnabled` / `customerFilesEnabled`，默认开启，`!== false` 判断） | `project-service`、`milestone-service`、`project-update-service` |
| 工单 | 列表（筛选）、新建、详情（对话式消息流、引用回复、附件、撤回、确认关闭） | `request-service.createRequest/listProjectRequests/getRequest`、`request-command-service.addRequestMessage/changeRequestStatus/confirmRequestClosed` |
| 附件 | 上传多态挂载（工单描述/回复/项目文件等），下载经 `readAttachmentDownload` 权限校验（INTERNAL 对客户 404、内容风险撤回 404） | `attachment-service` |
| 成员 | OWNER 可查看/邀请（邮件 token）/改角色/移除；Member 无管理入口 | `customer-member-service` |
| 通知 | 站内通知（聚合、已读）+ 声音 + 邮件（pg-boss outbox）+ 钉钉/webhook 渠道，规则表 `NotificationDeliveryRule` 按类型开关各渠道 | `notification-service`、`activity-policy`、`notification-email-service` |
| 实时 | Postgres LISTEN/NOTIFY → 落库 `EventRecord`（带自增游标，支持断线回放）→ SSE `/api/v1/notifications/stream`，按用户可见性过滤 | `postgres-event-listener`、`realtime-client`、`listVisibleEventBatch` |
| 账户 | 资料、邮箱变更（OTP 验证流程）、通知偏好 | `account-settings-view`、`/api/v1/me/*` |

权限要点：

- 角色只有两类：客户（`platformRole = CUSTOMER`）与员工（PM/TECHNICIAN/PLATFORM_ADMIN）。Actor 由 `resolveActor` 解析，所有领域查询走 `withActorDb(actor)`，在事务内 `set_config('app.user_id'...)`，由 **Postgres RLS 策略**保证 CustomerSpace 隔离。
- `customerRequestsEnabled = false` 时服务端强制拒绝（`request-service.ts:225/363/429`），不仅是 UI 隐藏——小程序直接继承该行为。
- 客户端组件实际调用的 HTTP 面是 `/api/v1/*`（projects/requests/attachments/notifications/me/admin customer-spaces invitations 等），这些路由全部是「`requireApiActor()` → 领域 Service」的薄壳。

---

## 2. 小程序技术方案与选型

### 选型：原生微信小程序 + TypeScript（无跨端框架）

理由：

1. PRD 明确 V1 仅发布微信小程序、不做支付宝/抖音兼容，跨端框架（Taro/uni-app）的抽象成本没有收益，反而会偏离原生交互（PRD §27 要求原生导航/TabBar/下拉刷新/预览）。
2. 团队现有栈是 TS + zod + Service 分层，原生小程序配合一套轻量请求封装即可对齐工程习惯。
3. 避免框架升级与微信基础库升级的双重风险。

配套工程决定：

- 小程序源码放仓库根 `miniapp/`，加入 pnpm workspace（复用 lint/tsconfig 风格、CI typecheck），npm 构建产物不入库。
- 视觉对齐：从 `src/theme/theme.ts` 提取设计 token（品牌色 `#1677ff`、状态色 `#16a466/#d98b16/#d14343`、圆角 10–14、文字 `#1d1d1f/#667085`）生成为小程序 `styles/tokens.wxss` 变量 + TS 常量，状态文案/色调复用 `src/lib/status-config.ts` 的映射（以共享 JSON 的方式双端引用，避免两份漂移）。

### API 策略：授权复用 `/api/v1/*`，微信特有能力新增 `/api/miniapp/*`

现有 `/api/v1` 路由的权限检查全部收敛在 `requireApiActor()`（`src/modules/projects/api-utils.ts:20`、`src/modules/requests/api.ts:13` 两处同构实现）：`getCurrentSession()`（better-auth cookie）→ `resolveActor()`。

方案：新增 `src/modules/miniapp/session.ts` 提供 `resolveMiniappSessionFromAuthorization()`——识别 `Authorization: Bearer <miniapp-token>`，校验 `MiniappSession` 表（有效期、revokedAt、用户未删除、platformRole=CUSTOMER）后返回与 Web 完全相同的 `Actor`。认证收口到统一入口 `src/modules/http/api-actor.ts`（`resolveApiActor()`）：**只要请求携带 Authorization 头，就只按 Bearer 验证，失败直接 401，绝不回落 Cookie**；未携带时走 better-auth Cookie 会话。两处旧 `requireApiActor()` 改为该入口的薄壳，调用方零改动。效果：

- **小程序直接调用现有 `/api/v1/projects|requests|attachments|notifications|me/*`**，权限、RLS、业务规则与 Web 字面相同，不存在第二套权限面；
- `/api/miniapp/*` 只承载微信特有：code2Session 登录、绑定、订阅消息授权上报、事件增量同步；
- 完全满足 PRD §28/§29「Mini Program Route → existing service」的架构要求，且业务路由零新增。

### 实时方案：EventRecord 游标增量同步（V1 不引入 WebSocket）

微信小程序无 EventSource；Next.js App Router 也不适合承载长连 WS。而现有事件已落库 `EventRecord`（持久、自增游标、断线回放），因此：

- 新增 `GET /api/miniapp/events?after=<cursor>`：复用 `listVisibleEventBatch`（已带用户可见性过滤）返回增量事件与新游标；
- 小程序端策略：页面 `onShow` 必刷新；工单对话页激活期间每 15–30s 拉一次增量（`onHide` 停止）；`wx.onNetworkStatusChange` 恢复后立即拉取；
- 这不是「长期频繁轮询」：只在用户停留的活跃页面轮询、且是游标增量而非全量，其余靠 onShow 刷新。满足 PRD §33 要求，且事件源完全复用现有机制（不造第二套）。

### 幂等与防重复（PRD §17/§34）

- 创建工单、发送回复支持 `X-Idempotency-Key` 请求头（客户端生成 UUID）；
- 服务层落地：`ServiceRequest` 增加可空 `clientMutationKey`，`@@unique([createdById, clientMutationKey])`；`RequestMessage` 同理。命中唯一冲突时返回已有记录而非报错；
- 附件上传成功但工单创建失败：沿用现有附件多态挂载设计——未挂载的孤儿附件已有清理 sweep 机制基础，V1 在创建失败时主动调用删除接口，并纳入现有 sweep 兜底。

---

## 3. 可直接复用的后端能力（不改业务逻辑）

| 能力 | 复用方式 |
|---|---|
| 全部客户业务规则 | `/api/v1/*` 薄壳 + 领域 Service 原样被小程序调用 |
| CustomerSpace 隔离 / RLS | `withActorDb(actor)` 与 Postgres 策略零改动（Actor 构造自同一 `resolveActor`） |
| 项目/里程碑/动态/工单/消息 | `project-service`、`milestone-service`、`project-update-service`、`request-service`、`request-command-service` |
| 附件上传下载权限 | `attachment-service` + `readAttachmentDownload`（`wx.uploadFile/downloadFile` 均支持自定义 header 带 Bearer） |
| 站内通知 | `/api/v1/notifications*`（列表/已读/摘要）直接可用 |
| 事件系统 | `EventRecord` + `listVisibleEventBatch` + 可见性过滤 |
| 邮件 OTP / 密码验证 | better-auth `emailAndPassword`、`emailOTP`（绑定方式一的验证） |
| token 生成与哈希模式 | `src/modules/invitations/invitation-token.ts`（随机 token + SHA hash 存储）用于绑定码 |
| 异步任务基础设施 | pg-boss（`src/lib/jobs.ts` + `src/worker.ts`）新增订阅消息 job |
| 渠道化通知投递模式 | 仿照钉钉渠道：`NotificationDeliveryRule` 渠道开关 + `activity-policy` + 异步投递 + 失败隔离 |
| 员工端成员管理 API 模式 | `/api/v1/admin/customer-spaces/*` 的路由/Service/测试范式，用于绑定码管理 |

---

## 4. 必须新增的接口与数据结构

### 4.1 Prisma 新模型（已落地，migration `20260816100000_wechat_miniapp_identity`）

实际实现与初稿的差异：`WechatBinding` **无 status 字段**——该表只表示「当前有效绑定」，解绑即删除记录（同事务删除全部 MiniappSession），历史经 AuditLog（`WECHAT_BINDING_REMOVED`）留存，避免 UNBOUND 行占用 openid/userId 唯一键。

```prisma
// 微信身份 ↔ 客户账号 当前有效绑定（V1 一对一；解绑即删除，历史入 AuditLog）
model WechatBinding {
  id          String   @id @default(cuid())
  userId      String   @unique
  openid      String   @unique
  unionid     String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  lastLoginAt DateTime?
  user User @relation(...)
}

// 一次性绑定码（管理员生成，hash 存储，格式如 8F3K-29DA；明文只在生成响应中出现一次）
model WechatBindingCode {
  id           String    @id @default(cuid())
  userId       String            // 只能绑定到生成时指定的客户身份
  codeHash     String    @unique
  expiresAt    DateTime
  usedAt       DateTime?
  revokedAt    DateTime?
  createdById  String
  createdAt    DateTime  @default(now())
  usedByOpenid String?          // 审计：哪个微信使用
}

// 小程序会话（与 better-auth Session 分表，避免侵入；30 天滑动过期）
model MiniappSession {
  id         String    @id @default(cuid())
  tokenHash  String    @unique
  userId     String
  createdAt  DateTime  @default(now())
  expiresAt  DateTime
  revokedAt  DateTime?
  lastSeenAt DateTime?
}

// 订阅消息授权额度（阶段 3 使用；客户端上报仅作发送状态，非权限凭证）
model WechatSubscribeGrant {
  id             String    @id @default(cuid())
  userId         String
  templateKey    String    // REQUEST_REPLY / REQUEST_STATUS / PROJECT_UPDATE
  remaining      Int       @default(0) // 剩余可发送额度，按微信实际发送结果修正
  lastReportedAt DateTime?
  updatedAt      DateTime  @updatedAt
  @@unique([userId, templateKey])
}

// 初稿未列、实现中补充的两张表：
// MiniappAuthTicket —— code2Session 成功但尚未绑定的待绑定票据（10 分钟、单次、含 OTP 发送计数）
// WechatBindGuard   —— 按 openid 的绑定尝试防暴力计数与锁定（5 次失败锁 10 分钟）
```

既有表的小改动：

- `NotificationDeliveryRule` 增加 `wechatEnabled Boolean @default(false)`（仿 `dingtalkEnabled`，阶段 3）；
- ~~`ServiceRequest` / `RequestMessage` 增加可空 `clientMutationKey`~~ 已落地（阶段 2，migration `20260816110000`）：服务层事务内按 `(作者, key)` 查重命中即返回已有记录，数据库复合唯一约束兜底并发；Web 不传 key（NULL）行为不变。

### 4.2 新增 HTTP 接口（`src/app/api/miniapp/*`）

| 接口 | 说明 |
|---|---|
| `POST /api/miniapp/auth/session` | `{ code }` → 服务端 `code2Session`（appsecret 仅在服务端）→ 已绑定则签发 MiniappSession token；未绑定返回 `NEED_BINDING` + 一次性 `bindingTicket`（短时效、绑定 openid） |
| `POST /api/miniapp/auth/bind/account` | `{ bindingTicket, email, password? 或 otp? }`（二选一），服务端复用 better-auth 正式验证（`signInEmail` / `signInEmailOTP`），成功后删除临时 Web Session；失败计数进入防暴力锁定 |
| `POST /api/miniapp/auth/bind/otp/send` | `{ bindingTicket, email }` 发送绑定用验证码（每票据最多 3 次，依赖平台「验证码登录」开关） |
| `POST /api/miniapp/auth/bind/code` | `{ bindingTicket, code }`，校验 hash/过期/撤销/单次使用（事务内 `usedAt` 置位防并发重放）；防暴力（按 openid 计数锁定） |
| `GET /api/miniapp/me` | 绑定状态 + 用户摘要 + 空间信息 |
| `GET /api/miniapp/events?after=` | 游标增量事件（见 §2） |
| `POST /api/miniapp/subscribe-message/grants` | 上报 `wx.requestSubscribeMessage` 结果，累加授权额度 |
| `DELETE /api/miniapp/auth/session` | 退出登录（撤销 session） |

员工 Web 侧新增（复用 admin API 范式，挂到现有客户空间成员管理）：

- 生成绑定码（返回明文一次）、列表、作废；
- 查看/解除成员的微信绑定。

### 4.3 无需新增

项目/工单/附件/通知/成员/账户的全部读写下行走现有 `/api/v1/*`，无需任何业务重实现。

---

## 5. 登录与账号绑定方案

```text
wx.login() → code
   ↓
POST /api/miniapp/auth/session（服务端 code2Session，取 openid）
   ↓
已绑定 → 签发 MiniappSession（Bearer token，30 天滑动过期）→ 进入首页
未绑定 → NEED_BINDING + bindingTicket（10 分钟、绑定该 openid、单次）
   ↓
┌─ 方式一：现有账号验证 ─────────────────┐  ┌─ 方式二：绑定码 ────────────┐
│ email + password（better-auth 校验）    │  │ 输入 8F3K-29DA              │
│ 或 email + OTP（无密码客户，同样走      │  │ 服务端 hash 比对 + 状态校验  │
│ better-auth 正式验证，无直读 hash）     │  │                            │
└────────────┬──────────────────────────┘  └──────────────┬──────────────┘
             └──────────→ 建立 WechatBinding（事务：唯一约束保证一对一）←─┘
                                ↓
                          签发 session，进入首页
```

- **身份永远服务端判定**：客户端只提交 wx code / 凭据 / 绑定码，openid 由 code2Session 得出，userId 由绑定关系得出，RLS 照常生效（PRD §30/§32）。
- **一对一唯一**：`openid @unique` + `userId @unique` 双向约束，事务内创建，并发重复绑定直接唯一冲突。
- **绑定码防暴力**：8 字符 32 母表（≈40bit）+ 有效期（默认 15 分钟）+ 按 openid 的失败计数锁定（如 5 次失败锁 10 分钟）+ 管理员可作废 + `usedAt` 事务置位（并发仅一次成功）。
- **Session 撤销**：用户被禁用/软删时懒撤销（resolveActor 已校验 `deletedAt`）+ 解绑/管理员操作时主动 `revokedAt`。
- 管理员在员工 Web 的客户空间成员页生成绑定码（明文只显示一次），配合线下/邮件告知客户。

---

## 6. 微信订阅消息方案

原则（PRD §23）：只做提醒渠道，异步、失败不影响业务。

1. **模板**（3 类，微信侧申请一次性订阅模板）：
   - `REQUEST_REPLY`：服务请求有新回复（含工单号/项目/状态，点击进入工单详情）；
   - `REQUEST_STATUS`：状态变化（开始处理/等待客户/已解决）；
   - `PROJECT_UPDATE`：重要项目动态。
2. **授权**：在合适节点（提交工单成功后、工单详情页「接收提醒」引导）调 `wx.requestSubscribeMessage`，结果上报 `/api/miniapp/subscribe-message/grants` 累加 `WechatSubscribeGrant.acceptCount`（一次性订阅 = 额度制）。
3. **发送链路**（完全仿钉钉渠道）：

```text
业务操作成功（同事务）
  → 站内 Notification 落库 + publishEvent（现有，不动）
  → NotificationDeliveryRule.wechatEnabled 开启 且 用户有额度
      → 扣减 acceptCount（条件更新防并发）
      → pg-boss 入队 WECHAT_SUBSCRIBE_MESSAGE_JOB（幂等键）
  → worker 调微信 subscribeMessage.send
      → 成功/失败只记录投递日志；失败不重试业务、不抛错
```

4. **入口点击**：订阅消息 `page` 指向小程序工单详情页并带 `requestId`，页面 onLoad 鉴权后跳转（无权即显示「无权查看」态）。

---

## 7. 预计新增目录与主要模块

```text
miniapp/                          # pnpm workspace 新包（原生小程序 + TS）
├── src/
│   ├── app.ts / app.json         # 4 Tab：项目 / 工单 / 消息 / 我的
│   ├── pages/
│   │   ├── projects/             # Tab 项目列表
│   │   ├── project-detail/       # 概览/里程碑/动态/请求/文件（Tab 按项目开关门控）
│   │   ├── requests/             # Tab 工单列表（筛选/搜索/下拉刷新/加载更多）
│   │   ├── request-detail/       # 对话流 + 引用回复 + 附件 + 全屏图片预览
│   │   ├── request-new/          # 新建（幂等提交）
│   │   ├── messages/             # Tab 通知中心
│   │   ├── profile/              # Tab 我的
│   │   ├── profile-edit/ members/ notification-settings/
│   │   └── auth/                 # 登录中 / 绑定账号 / 绑定码
│   ├── components/               # status-indicator、card、skeleton、empty-state、chat-bubble…
│   ├── lib/                      # request 封装（Bearer/401 重登/重试）、api 客户端、
│   │                             # 事件增量同步、设计 token、状态映射
│   └── styles/tokens.wxss        # 由 Web theme 派生
└── project.config.json / package.json / tsconfig.json

src/modules/miniapp/              # 后端新模块（与现有 modules 同构）
├── session.ts                    # Bearer → Actor 解析（requireApiActor 集成点）
├── wechat-auth-service.ts        # code2Session、bindingTicket、session 签发/撤销
├── wechat-binding-service.ts     # 两种绑定 + 唯一性 + 解绑
├── binding-code-service.ts       # 生成/校验/作废/防暴力
├── subscribe-message-service.ts  # 额度管理 + 入队
├── wechat-api-client.ts          # access_token 缓存 + subscribeMessage.send
└── errors.ts

src/app/api/miniapp/**            # §4.2 路由
src/modules/notifications/…       # wechat 渠道投递（policy + 入队，仿 dingtalk）
src/lib/jobs.ts / src/worker.ts   # WECHAT_SUBSCRIBE_MESSAGE_JOB
员工 Web：客户空间成员管理页 + 绑定码管理（少量 UI + admin 路由）
```

小程序源码与本仓同库不同包，Web 现有代码零大规模改动（仅 `requireApiActor` 两处小改 + schema 增列）。

---

## 8. 风险点

| 风险 | 应对 |
|---|---|
| SSE/EventSource 在小程序不可用 | 已按游标增量同步设计（§2）；若后续要求秒级实时，V2 再评估独立 WS 网关，不在本期 |
| 一次性订阅消息额度制，用户不授权就收不到 | 产品文案引导 + 站内通知/角标兜底；发送失败静默隔离 |
| 微信侧依赖：appid/appsecret、类目、订阅消息模板审核周期 | 阶段 1 即需申请；开发期用微信开发者工具 + 测试号打通 code2Session，正式模板后切换 |
| unionid 需微信开放平台绑定 | V1 仅用 openid（绑定关系落到本 appid），`unionid` 字段预留 |
| `wx.openDocument` 支持格式有限（doc/xls/ppt/pdf 等） | 不支持时给「已复制下载链接/在电脑端查看」提示（PRD §14 允许） |
| ~~better-auth 密码服务端复用校验方式需验证~~ | 已解决：`auth.api.signInEmail` / `signInEmailOTP` 服务端调用可行，验证成功后立即删除产生的临时 Web Session；**明确禁止直读 bcrypt/hash 的 fallback** |
| 生产库 migration（新表 + 既有表加列） | 全部为可空/默认值列，向后兼容；先在集成测试库验证 |
| 双端状态文案/视觉漂移 | 状态映射抽成共享 JSON，构建期生成小程序常量；设计 token 单向从 Web theme 派生 |
| 弱网重复提交 | 幂等键 + 提交中锁按钮 + 失败可重试（同 key 安全） |
| 敏感信息泄漏 | appsecret/Session token 不落日志；绑定码只存 hash；错误信息不区分「码不存在/已用过」以防探测 |

---

## 9. 实施阶段划分

| 阶段 | 内容 | 验收（对应 PRD Flow） |
|---|---|---|
| **0. 脚手架**（0.5 周） | `miniapp/` workspace 包、TabBar/导航/设计 token、请求封装骨架、CI 接入 typecheck | 工程可编译预览 |
| **1. 身份与绑定**（1 周） | Prisma migration、`/api/miniapp/auth/*`、两种绑定、MiniappSession、员工端绑定码管理 UI、better-auth 校验 spike、单测+集成测试（唯一性/单次/过期/越权/未绑定 401） | Flow 1、2、7 |
| **2. 项目与工单**（1.5 周） | requireApiActor Bearer 集成、项目列表/详情五模块、工单列表/新建（幂等）/详情对话/附件（上传下载预览）、事件增量同步 | Flow 3、4、5 |
| **3. 消息与订阅**（1 周） | 消息中心 Tab、订阅消息全链路（模板/额度/入队/worker）、通知设置、我的/资料/成员管理入口 | Flow 6 |
| **4. 打磨与验收**（0.5–1 周） | Loading/Empty/Error/Offline/Permission 全覆盖、安全自查（§36 清单）、补齐测试、跑全量 `pnpm check` 与 e2e 回归、DoD 逐项核对 | 全部 DoD |

现有测试不受破坏：所有 `/api/v1` 改动为纯增量（新增 Bearer 分支，cookie 路径行为不变），新逻辑独立模块 + 独立测试。

---

## 待确认决策

### 开发约束（持续有效）

- **Prisma DateTime / UTC 墙钟规则**：本项目全部 Prisma `DateTime` 列为 `TIMESTAMP(3)` 无时区，全链路按 UTC 墙钟读写。测试或脚本经原生 SQL 写这些列时必须用 `NOW() AT TIME ZONE 'utc'`，禁止裸 `NOW()`（会按服务器会话时区写入导致时区漂移）。
- **集成测试要求**：项目、工单、附件等涉及 CustomerSpace 的能力必须用真实 PostgreSQL 集成测试（`tests/integration/`），且至少覆盖**两个不同 CustomerSpace 的横向越权**场景（A 持 B 的 projectId/requestId/attachmentId 必须被服务端拒绝）。
- **Baseline known issue**：`tests/components/customer-service-request-grid.test.tsx` 的 1 个失败与 5 个 lint 错误为阶段 1 之前工作树已存在的存量问题，不纳入小程序改动范围，各阶段测试报告中单独标记，不顺手修复。
- **绑定码与解绑权限**：平台管理员 + CustomerSpace Owner；生成/作废/解除绑定均有服务端权限校验并写 AuditLog。
- **dev Provider 使用**：正式 AppID/AppSecret 到位前，开发与集成测试使用 `MINIAPP_WECHAT_PROVIDER=dev`；生产环境该值被硬性拒绝。
- **实时通道约束（永久）**：小程序事件同步只允许 SSE 流（enableChunked + 指数退避重连 + 网络恢复立即重连 + Last-Event-ID 续传）。**禁止引入任何形式的轮询兜底**——连接建立与断线恢复均由流自身完成（服务端先按游标回放再 READY）。

### 决策记录

1. ~~技术选型~~：已确认原生微信小程序 + TypeScript（`miniapp/` workspace 包）；
2. ~~API 策略~~：已确认 Bearer 复用 `/api/v1/*`，收口统一认证入口；
3. ~~实时方案~~：已确认游标增量 + onShow 刷新，V1 不引入 WebSocket；
4. ~~代码位置~~：已确认 `miniapp/` workspace 包；
5. **微信主体资料**：正式 AppID/AppSecret 与订阅消息模板仍待提供——当前 dev Provider 已可完整联调登录/绑定闭环，配置 `MINIAPP_WECHAT_PROVIDER=dev` 即可；正式凭据就绪后切 `real` 并设置 `WECHAT_MINIAPP_APPID/WECHAT_MINIAPP_APP_SECRET`（阶段 3 订阅消息与最终真机验收前提供）。
