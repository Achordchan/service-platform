# 插件开发 SOP

平台插件是随主项目构建、由白名单加载的可信代码包。后台只能管理已安装插件的状态和配置，不能上传或执行任意代码。

## 1. 创建插件

1. 复制 `plugins/image-webp` 的目录结构，或在独立 Git 仓库创建同结构的 npm 包。
2. 依赖 `@achord/platform-plugin-sdk`，导出 manifest；插件 key 使用小写字母、数字和连字符，发布后不可变更。
3. 在主项目 `src/modules/plugins/plugin-registry.ts` 中显式注册。
4. 插件首次部署必须默认关闭，管理员完成环境检测后再启用。

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

## 2. 配置与生命周期

- 配置必须由插件提供 Zod schema，并由服务端再次验证。
- 安装记录由 `PluginInstallation` 保存；升级只能更新版本和兼容配置，不能自动启用。
- 长任务写入 `PluginRun`，单项幂等状态写入 `PluginResourceState`。
- `enable` 前执行健康检查；`disable` 后不得创建新任务，活动批量任务转为暂停。
- 暂停、取消必须在单项任务边界生效，不能中断正在写文件或提交事务的临界区。

## 3. 后台任务

- HTTP 请求只创建任务，不执行 CPU 密集或长时间工作。
- 使用 pg-boss 独立队列；默认单并发，失败必须有限重试。
- 每个资源处理必须可重复执行，并用输入指纹防止重复修改。
- 任务进度通过 `PLUGIN_RUN_UPDATED` SSE 事件推送，禁止前端定时轮询。

## 4. 数据与发布

- 插件不能自行执行数据库 migration。需要的数据表必须进入主项目 Prisma schema、migration 和 RLS 审查。
- 发布前更新插件版本、锁文件和开发文档，并执行完整验证命令。
- 独立仓库插件发布为私有 npm 包后，由主项目固定版本安装并加入注册白名单。

## 5. 发布检查清单

- manifest key、版本和最低平台版本正确。
- 配置 schema、默认值和后台字段一致。
- 默认关闭，健康检查失败时不能启用。
- 所有任务有幂等、暂停、取消、失败和清理路径。
- 未记录密钥、文件正文、客户隐私数据或完整异常对象。
- 已验证权限、RLS、审计、SSE、移动端布局和生产构建。
