# 服务支持中心

通用客户服务交付平台：客户项目空间 + 进度交付 + 项目内服务请求。

## 技术栈

- Node.js 24 LTS
- Next.js 16 + TypeScript
- MUI 9 / MUI X DataGrid
- Better Auth
- PostgreSQL 16 + Prisma
- pg-boss 邮件与插件后台任务
- 本地发件箱（后台可查看）/ Resend API / SMTP

## 本地启动

### 1. 环境

```bash
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
node -v   # 需要 24.x
```

复制环境变量：

```bash
cp .env.example .env
```

默认连接：

- App: `http://localhost:3000`
- PostgreSQL: `localhost:5438`

### 2. 安装依赖

```bash
pnpm install
```

### 3. 数据库

确保 PostgreSQL 16 已启动，并创建数据库与角色。随后：

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

### 4. 启动

```bash
pnpm dev
```

访问 [http://localhost:3000](http://localhost:3000)。

本地默认只需要这一个进程：邮件会进入后台「平台设置 → 发件箱」。  
`pnpm worker` 用于单独运行邮件和插件后台任务。

生产环境使用独立的 `service-platform-worker`，Web 进程不会再重复启动邮件 Worker；如需显式配置，请在生产环境设置 `MAIL_INLINE_WORKER=false`。

## 本地演示账号

统一密码：`ServiceDemo!2026`

| 角色 | 邮箱 |
| --- | --- |
| 平台管理员 | `admin@local.test` |
| 项目负责人 | `manager@local.test` |
| 技术人员 | `tech@local.test` |
| 客户 Owner | `client@local.test` |
| 客户成员 | `client2@local.test` |

## 生产部署（VPS）

- 域名：`https://support.achord.cn`
- 运行方式：systemd + Nginx 反代 + PostgreSQL（非 Docker / 非宝塔）
- 代码目录：`/var/www/service-platform`
- 服务：`service-platform`（Web）、`service-platform-worker`（邮件与插件任务）
- 推送到 `main` 或手动触发 GitHub Action `Deploy to VPS` 即可更新（**构建在 GitHub 完成，VPS 不执行 next build**）
- 本地紧急部署：`scripts/vps-deploy-local.sh`

所需 GitHub Secrets：`VPS_HOST`、`VPS_USER`、`VPS_SSH_KEY`，可选 `VPS_PORT`、`APP_URL`。

## 常用命令

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm exec vitest run --config vitest.integration.config.ts
pnpm test:e2e
pnpm build
pnpm check
```

## 目录约定

- `src/app`：页面与 Route Handlers
- `src/modules`：领域服务、权限与业务规则
- `src/components`：客户/员工界面
- `prisma`：数据模型与迁移
- `tests`：单元与安全集成测试
- `e2e`：Playwright 主流程
- `packages/platform-plugin-sdk`：可信构建期插件契约
- `plugins`：随平台构建的受信任插件
- `docs/plugins`：插件开发 SOP 与边界

## 开发约束

- 页面不直接访问 Prisma，统一经领域服务
- 客户数据按 `customerSpaceId` 与 RLS 隔离
- 实时通知使用 SSE，不使用轮询
- 本地附件保存在 `.data/uploads`，正式环境需切换私有对象存储
- 不要自动提交代码，除非明确要求

## 后续部署

当前仓库仅本地开发。后续可用 GitHub Actions 调用：

`pnpm lint && pnpm typecheck && pnpm test && pnpm build`


## 邮件说明

- 本地默认写入后台「平台设置 → 发件箱」；需要测试 SMTP 时可指向 Mailpit（`127.0.0.1:1025`）。
- 正式环境默认使用 Resend API：
  - 发信域名：`mail.achord.cn`
  - 发件人：`服务支持中心 <no-reply@mail.achord.cn>`
  - 回复地址：`support@achord.cn`
  - Webhook：`https://support.achord.cn/api/v1/webhooks/resend`
- Resend API Key 和 Webhook Secret 由平台管理员在后台录入并加密保存。生产环境推荐使用 `openssl rand -base64 32` 生成 `PLATFORM_SECRET_ENCRYPTION_KEY`；未设置时系统会从现有 `BETTER_AUTH_SECRET` 稳定派生兼容密钥，避免旧服务器升级后无法启动。
- 邮件在入队时即写入发件箱；Resend 使用稳定幂等键防止任务重试造成重复发信，SMTP 为避免重复投递不自动重试。
- 邀请、密码重置和测试邮件统一由后台「邮件模板」维护，仅允许纯文本和固定变量。
- 后台连接 Resend 后会显示需要添加到 Cloudflare 的 DNS 记录；不要修改 `achord.cn` 主域现有 Email Routing MX/SPF。
- 完成域名验证和测试邮件后，再在后台启用 Resend。SMTP 保留为折叠的故障备用方式。
- 邀请邮件依赖 `APP_URL`，正式环境请改成线上域名。
