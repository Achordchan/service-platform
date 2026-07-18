# 通用工单连接器

- 插件 key：`universal-embed-connector`
- 协议：`Achord Connect v1`
- 类型：`EXTERNAL_CONNECTOR`
- 默认状态：关闭

插件只负责第三方身份票据、项目连接配置和 Webhook。工单、聊天、附件、Presence、SSE 和外部会话由宿主的 `external-portal` 核心提供，禁止在插件内复制这些业务实现。

## 能力

- `project:bind`
- `external-identity:verify`
- `launch-ticket:issue`
- `embed-session:issue`
- `events:publish`
- `mail:enqueue`
- `webhook:deliver`
- `network:webhook`

## 维护边界

- Manifest 和 Runtime 进入构建期静态注册，不接受后台上传代码。
- 数据表、RLS、CHECK 约束和宿主 API 变化必须由主项目 migration 审查。
- 插件不得读取 Prisma、认证 Session 或任意文件路径；敏感配置必须使用宿主加密能力。
- 连接器故障不得影响标准项目、Sub2API 项目、邀请登录、邮件和附件主流程。
