"use client";

import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";

const packageTree = `plugins/example-plugin/
├── package.json
└── src/
    ├── manifest.ts
    ├── runtime.ts
    └── config.ts`;

const manifestExample = `export const manifest = {
  key: "example-plugin",
  name: "示例插件",
  description: "插件用途",
  version: "1.0.0",
  category: "业务扩展",
  minimumPlatformVersion: "0.1.0",
  capabilities: [],
  defaultConfig: {},
  settings: [],
};`;

const verificationCommands = `pnpm lint
pnpm typecheck
pnpm test
pnpm exec vitest run --config vitest.integration.config.ts
pnpm build
pnpm verify:runtime-deps`;

export function PluginDeveloperGuideDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState(0);
  function closeDialog() {
    setTab(0);
    onClose();
  }

  return (
    <Dialog open={open} onClose={closeDialog} fullWidth maxWidth="md">
      <DialogTitle>插件开发规范</DialogTitle>
      <DialogContent sx={{ px: { xs: 2, sm: 3 } }}>
        <Stack spacing={2.5} sx={{ pt: 0.5 }}>
          <Alert severity="info">
            平台只运行随代码构建并进入白名单的可信插件，不支持后台上传或执行插件压缩包。
          </Alert>
          <Tabs
            value={tab}
            onChange={(_event, value: number) => setTab(value)}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
            aria-label="插件开发文档章节"
          >
            <Tab label="开发流程" />
            <Tab label="权限边界" />
            <Tab label="发布验收" />
          </Tabs>
          <Divider />

          {tab === 0 ? <DevelopmentGuide /> : null}
          {tab === 1 ? <BoundaryGuide /> : null}
          {tab === 2 ? <ReleaseGuide /> : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button onClick={closeDialog}>关闭</Button>
      </DialogActions>
    </Dialog>
  );
}

function DevelopmentGuide() {
  return (
    <Stack spacing={2.5}>
      <GuideSection title="1. 建立独立插件包">
        <Typography variant="body2" color="text.secondary">
          插件放在平台仓库的 plugins 目录，或发布为固定版本的私有 npm
          包。插件 key 发布后不能修改，首次安装必须保持关闭。
        </Typography>
        <CodeBlock>{packageTree}</CodeBlock>
      </GuideSection>

      <GuideSection title="2. 声明 manifest">
        <Typography variant="body2" color="text.secondary">
          manifest 必须声明版本、最低平台版本、能力、配置字段和后台操作。配置同时提供
          Zod schema，服务端不能直接信任后台提交值。
        </Typography>
        <CodeBlock>{manifestExample}</CodeBlock>
      </GuideSection>

      <GuideSection title="3. 注册与接入宿主">
        <RequirementList
          items={[
            "在 src/modules/plugins/plugin-registry.ts 中显式注册。",
            "只通过 @achord/platform-plugin-sdk 和宿主服务访问平台能力。",
            "长任务进入 pg-boss 队列，进度使用 PLUGIN_RUN_UPDATED SSE。",
            "数据库结构由主项目 migration 提供，插件不能自行执行 migration。",
            "插件升级后清除旧健康结果，重新检测通过前不执行新任务。",
          ]}
        />
      </GuideSection>
      <GuideSection title="4. 生命周期">
        <RequirementList
          items={[
            "安装：宿主同步 manifest，首次安装保持关闭。",
            "检测：验证依赖、文件能力和外部服务，不写入业务数据。",
            "启用：检测通过后才允许创建新任务。",
            "停用：停止新任务，活动批量任务在安全边界暂停。",
            "升级：自动停用并暂停批量任务，重新检测后再启用。",
          ]}
        />
      </GuideSection>
    </Stack>
  );
}

function BoundaryGuide() {
  return (
    <Stack spacing={2.5}>
      <GuideSection title="允许的能力">
        <RequirementList
          items={[
            "读取宿主明确传入的资源 ID、配置和文件字节。",
            "通过受限接口创建后台任务、更新任务进度和发布事件。",
            "使用 PluginInstallation、PluginRun、PluginResourceState 保存通用状态。",
            "在 manifest 中声明后访问附件转换等受控能力。",
            "敏感配置只能调用宿主加密存储，普通 JSON 配置不得保存密钥。",
          ]}
        />
      </GuideSection>

      <GuideSection title="禁止的行为">
        <RequirementList
          tone="error"
          items={[
            "直接导入 Prisma Client、认证内部模块或数据库连接。",
            "读取任意文件路径、环境变量、密钥或其他插件私有数据。",
            "绕过 Actor 权限、RLS、审计和附件可见范围。",
            "在 Web 请求中执行批量扫描、压缩或其他长时间 CPU 任务。",
            "把密钥、令牌、文件正文或完整异常对象写入日志和 SSE。",
          ]}
        />
      </GuideSection>

      <GuideSection title="故障边界">
        <Typography variant="body2" color="text.secondary">
          插件失败不能阻断上传、聊天、邮件或项目操作。文件转换必须采用“写新文件
          → 条件切换数据库 → 删除旧文件”，失败时继续使用原文件。
        </Typography>
      </GuideSection>
    </Stack>
  );
}

function ReleaseGuide() {
  return (
    <Stack spacing={2.5}>
      <GuideSection title="版本与兼容">
        <RequirementList
          items={[
            "任何运行逻辑或依赖变化都必须提升插件版本。",
            "版本变化后自动停用，重新检测失败时禁止启用。",
            "原生依赖必须锁定版本，并在 GitHub Ubuntu 与 VPS Linux 验证。",
            "原生依赖由主应用直接声明，禁止依赖 Turbopack 哈希别名。",
            "插件默认关闭，历史迁移只能由平台管理员手动启动。",
          ]}
        />
      </GuideSection>

      <GuideSection title="发布检查">
        <RequirementList
          items={[
            "manifest、配置 schema、后台字段和默认值完全一致。",
            "任务支持幂等、暂停、继续、取消、失败重试和文件清理。",
            "数据库表已完成 migration、索引、外键和 RLS 审查。",
            "桌面端、390px 移动端、长文案和错误状态已检查。",
            "不存在 Mock、调试入口、console.log 或未受控网络请求。",
          ]}
        />
      </GuideSection>

      <GuideSection title="标准验证命令">
        <CodeBlock>{verificationCommands}</CodeBlock>
        <Typography variant="caption" color="text.secondary">
          完整仓库文档位于 docs/plugins/development.md 和
          docs/plugins/boundaries.md。
        </Typography>
      </GuideSection>
    </Stack>
  );
}

function GuideSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Stack spacing={1.25}>
      <Typography sx={{ fontWeight: 750 }}>{title}</Typography>
      {children}
    </Stack>
  );
}

function RequirementList({
  items,
  tone = "default",
}: {
  items: string[];
  tone?: "default" | "error";
}) {
  return (
    <Stack component="ul" spacing={0.75} sx={{ m: 0, pl: 2.5 }}>
      {items.map((item) => (
        <Typography
          component="li"
          variant="body2"
          color={tone === "error" ? "error.main" : "text.secondary"}
          key={item}
        >
          {item}
        </Typography>
      ))}
    </Stack>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <Box
      component="pre"
      sx={{
        m: 0,
        p: 1.5,
        maxWidth: "100%",
        overflowX: "auto",
        borderRadius: 1.5,
        bgcolor: "action.hover",
        color: "text.primary",
        fontFamily: "monospace",
        fontSize: 13,
        lineHeight: 1.65,
        whiteSpace: "pre",
      }}
    >
      {children}
    </Box>
  );
}
