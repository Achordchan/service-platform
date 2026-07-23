# 插件开发 SOP

平台插件是随主项目构建、由白名单加载的可信代码包。后台只能管理已安装插件的状态和配置，不能上传或执行任意代码。

平台管理员可在「插件中心 → 插件开发规范」查看简版说明；本目录保存完整开发与发布规范。

> **完成定义：插件包完成不等于插件功能完成。** 独立包能编译、能测试，只代表核心实现可用。插件只有同时完成宿主白名单注册、后台配置、真实健康检测、业务事件接入、异步投递、停用边界、主 CI 和页面验收，才可以标记为“已完成”。未出现在插件中心的实现一律属于未接入状态。

## 0. 五阶段交付门槛

1. **包实现**：manifest、配置解析、运行时和独立测试完成，不包含 Mock 或演示入口。
2. **宿主注册**：主应用声明固定依赖，并在 `plugin-registry.ts` 显式注册；插件必须出现在插件中心且默认关闭。
3. **配置与检测**：普通配置通过 schema，密钥由宿主加密保存且不回显；健康检测必须无业务副作用。存在只读检测接口时可验证外部连通性；若外部服务只能通过写操作验证，则检查配置与运行时，并把真实测试投递设计成独立、明确标注的管理员操作。
4. **业务与队列**：真实业务事件写入事务化 Outbox，由 pg-boss 异步投递；必须有幂等键、有限重试、失败记录、崩溃恢复和 Sweep 补偿。
5. **停用与验收**：停用后不再创建或发送任务，待处理项进入明确终态；独立包测试进入主 CI，并完成权限、桌面端、移动端、构建和部署验证。

消息通知插件还必须完成：每个支持事件在统一通知规则中声明独立通道开关；模板由插件拥有并支持变量校验、预览、恢复默认和显式测试；业务事件发生时把模板快照写入 Outbox，禁止 Worker 临发送时读取可变模板。

以下任一情况都不得称为“插件开发完成”：

- 插件中心没有该插件。
- 后台无法保存配置，或真实健康检测无法通过。
- 没有实际业务入口、Outbox、Worker、幂等和失败状态。
- 只运行插件包测试，未进入主项目类型检查、测试和部署工作流。
- README 使用“完整插件”等表述，同时把宿主接入列为后续工作。

## 1. 目录与注册

在平台仓库中使用以下最小结构；独立仓库插件也必须发布成固定版本的私有 npm 包后再接入主项目。

```text
plugins/example-plugin/
├── package.json
└── src/
    ├── manifest.ts
    ├── config.ts
    └── runtime.ts
```

1. 依赖 `@achord/platform-plugin-sdk`，插件 key 只使用小写字母、数字和连字符，发布后不可变更。
2. 在 `src/modules/plugins/plugin-registry.ts` 显式注册 manifest 和配置解析器。
3. 插件不得通过目录扫描、后台上传或运行时下载实现动态加载。
4. 首次安装保持关闭；管理员完成环境检测后才能启用。
5. 根 `package.json` 必须声明插件依赖，锁文件必须包含对应 workspace 或固定版本。

最小 manifest：

```ts
import type { PlatformPluginManifest } from "@achord/platform-plugin-sdk";

export const manifest: PlatformPluginManifest<Record<string, unknown>> = {
  key: "example-plugin",
  name: "示例插件",
  description: "插件用途",
  version: "1.0.0",
  category: "业务扩展",
  minimumPlatformVersion: "0.1.0",
  capabilities: [],
  defaultConfig: {},
  settings: [],
};
```

manifest 字段：

| 字段 | 规则 |
| --- | --- |
| `key` | 全局唯一、发布后不可修改 |
| `version` | 运行代码、依赖或配置语义变化时必须提升 |
| `minimumPlatformVersion` | 声明最低兼容平台版本 |
| `capabilities` | 只声明实际使用的宿主能力 |
| `defaultConfig` | 只包含非敏感默认配置 |
| `settings` | 与服务端配置 schema 一一对应 |
| `actions` | 声明后台可触发的显式操作 |

## 2. 配置与生命周期

- 配置必须由插件提供 Zod schema，并由服务端再次验证。
- 普通 JSON 配置不得保存 API Key、令牌或密码；敏感值必须使用宿主加密存储能力。
- 安装记录由 `PluginInstallation` 保存；升级只能更新版本和兼容配置，不能自动启用。
- manifest 版本变化时自动停用插件、暂停活动批量任务并清除旧健康结果；重新检测通过前不得创建或继续任务。
- 长任务写入 `PluginRun`，单项幂等状态写入 `PluginResourceState`。
- `enable` 只校验最近一次健康结果与当前配置指纹，不得隐式重复执行健康检查；`disable` 后不得创建新任务，活动批量任务转为暂停。
- 保存敏感配置、健康检测和启用是三个明确状态；密钥变更后必须自动停用并清除旧健康结果。
- 暂停、取消必须在单项任务边界生效，不能中断正在写文件或提交事务的临界区。

生命周期：

1. **安装**：宿主同步白名单 manifest，创建关闭状态的安装记录。
2. **检测**：验证运行依赖、文件能力和外部服务，不修改业务数据。
3. **启用**：仅健康状态为 `READY` 时允许创建任务。
4. **停用**：停止新任务，活动批量任务在安全边界暂停。
5. **升级**：提升版本、自动停用、暂停活动批量任务、清除旧健康状态并重新检测。

## 3. 宿主能力与后台任务

- HTTP 请求只创建任务，不执行 CPU 密集或长时间工作。
- 使用 pg-boss 独立队列；默认单并发，失败必须有限重试。
- 每个资源处理必须可重复执行，并用输入指纹防止重复修改。
- 任务进度通过 `PLUGIN_RUN_UPDATED` SSE 事件推送，禁止前端定时轮询。
- 插件只能使用 manifest 声明且由宿主提供的能力；v1 能力定义位于 `packages/platform-plugin-sdk/src/index.ts`。
- 插件不得直接导入 Prisma、认证内部模块、任意文件路径或其他插件实现。
- 业务事务只写 Outbox，不直接请求第三方；Outbox 必须由 Worker 异步发送，并具备幂等、有限重试、失败记录和 Sweep 补偿。

## 4. 数据、文件与故障

- 插件不能自行执行数据库 migration。需要的数据表必须进入主项目 Prisma schema、migration 和 RLS 审查。
- 文件读取必须由宿主按 storage key 完成路径校验；插件只接收宿主传入的字节。
- 文件替换使用“写新文件 → 条件切换数据库 → 删除旧文件”，失败时保留原文件。
- 插件故障不能阻断上传、聊天、邮件、项目或服务请求等核心流程。
- 日志、审计和 SSE 中禁止写入密钥、令牌、文件正文和完整异常对象。

## 5. 原生依赖

- 原生依赖必须锁定精确版本，并在 Node.js 24、GitHub Ubuntu 和 VPS Linux 上验证。
- 原生依赖必须同时作为主应用直接生产依赖安装，运行时从应用根目录解析，禁止依赖 Turbopack 生成的 `sharp-<hash>` 别名。
- 生产构建后必须执行 `pnpm verify:runtime-deps`；脚本会拒绝仍引用哈希别名的构建，工作流部署后还会在 VPS 再次加载验证。
- 新增其他原生运行时依赖时，必须同步扩展 `scripts/verify-runtime-dependencies.mjs`。

## 6. 版本、发布与回滚

- 发布前更新插件版本、锁文件和开发文档，并执行完整验证命令。
- 插件包的 `typecheck` 和 `test` 必须进入主 GitHub Actions，不能只由开发者本机手动运行。
- 独立仓库插件发布为私有 npm 包后，由主项目固定版本安装并加入注册白名单。
- 插件升级不得自动启动历史迁移；回滚代码时还要确认旧版本能读取现有配置和资源状态。
- 生产更新只通过 `main` 的 GitHub Actions，禁止手工覆盖 VPS 应用目录。

标准验证：

```bash
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration:prepare
pnpm test:integration
# 必须先有 .env.integration；禁止为集成测试裸跑 prisma migrate deploy / pnpm db:seed
pnpm build
pnpm verify:runtime-deps
```

## 7. 发布检查清单

- manifest key、版本和最低平台版本正确。
- 插件已经显示在插件中心，配置、检测、启用和停用流程均可操作。
- 配置 schema、默认值和后台字段一致。
- 默认关闭，健康检查失败时不能启用。
- 所有任务有幂等、暂停、取消、失败和清理路径。
- 业务事件通过事务化 Outbox 进入队列，Worker 中断后可由 Sweep 恢复。
- 未记录密钥、文件正文、客户隐私数据或完整异常对象。
- 原生依赖别名已进入发布包，生产运行时可加载。
- 已验证权限、RLS、审计、SSE、移动端布局和生产构建。
- 不存在 Mock、调试入口、`console.log`、`debugger` 或临时测试按钮。

连接器类插件还应参考 [Sub2API 工单连接器](./sub2api-connector.md)，重点检查外部身份兑换、会话撤销、SSRF 防护、动态 `frame-ancestors` 和反向代理查询字符串日志。
