"use client";

import { useState, type ReactNode } from "react";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from "@mui/material";

export type UniversalGuideStage =
  | "CONFIGURE"
  | "CREDENTIALS"
  | "ACTIVATE"
  | "ACTIVE";

const stageMessages: Record<UniversalGuideStage, string> = {
  CONFIGURE: "当前下一步：填写第三方网页的 HTTPS Origin 并保存连接配置。",
  CREDENTIALS: "当前下一步：生成 Client ID 和 Client Secret，并立即保存到第三方后端。",
  ACTIVATE: "当前下一步：执行连接检测，通过后激活连接。Webhook 可以稍后配置。",
  ACTIVE: "连接已经激活。第三方后端现在可以为已登录用户创建一次性进入票据。",
};

export function UniversalIntegrationGuideDialog({
  open,
  onClose,
  stage,
  platformOrigin,
}: {
  open: boolean;
  onClose: () => void;
  stage: UniversalGuideStage;
  platformOrigin: string;
}) {
  const [tab, setTab] = useState(0);

  function closeDialog() {
    setTab(0);
    onClose();
  }

  return (
    <Dialog open={open} onClose={closeDialog} fullWidth maxWidth="md">
      <DialogTitle>Achord Connect 接入指南</DialogTitle>
      <DialogContent sx={{ px: { xs: 2, sm: 3 } }}>
        <Stack spacing={2.5} sx={{ pt: 0.5 }}>
          <Alert severity={stage === "ACTIVE" ? "success" : "info"}>
            {stageMessages[stage]}
          </Alert>
          <Tabs
            value={tab}
            onChange={(_event, value: number) => setTab(value)}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
            aria-label="Achord Connect 接入文档章节"
          >
            <Tab label="接入步骤" />
            <Tab label="代码示例" />
            <Tab label="产品边界" />
          </Tabs>
          <Divider />
          {tab === 0 ? <QuickStartGuide /> : null}
          {tab === 1 ? <CodeGuide platformOrigin={platformOrigin} /> : null}
          {tab === 2 ? <BoundaryGuide /> : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button onClick={closeDialog}>关闭</Button>
      </DialogActions>
    </Dialog>
  );
}

function QuickStartGuide() {
  return (
    <Stack spacing={2.5}>
      <GuideSection title="1. 配置网页来源">
        <Typography variant="body2" color="text.secondary">
          Origin 是第三方系统承载 iframe 的网页来源，例如
          https://app.example.com。只能填写协议、域名和端口，不能包含路径。
        </Typography>
      </GuideSection>
      <GuideSection title="2. 生成服务端凭据">
        <Typography variant="body2" color="text.secondary">
          Client Secret 只显示一次，只能保存在第三方后端。不能放进浏览器、前端环境变量、APK
          或 IPA。
        </Typography>
      </GuideSection>
      <GuideSection title="3. 检测并激活">
        <Typography variant="body2" color="text.secondary">
          至少配置一个 Origin 和一个有效凭据后执行连接检测。Webhook
          是可选项，不配置也可以先激活连接。
        </Typography>
      </GuideSection>
      <GuideSection title="4. 每次进入都创建票据">
        <Typography variant="body2" color="text.secondary">
          第三方用户登录后，由第三方后端提交稳定的字符串用户 ID、名称和可选邮箱。接口返回的
          launchUrl 有效期为 60 秒且只能使用一次，前端应立即把它设置为 iframe 的 src。
        </Typography>
      </GuideSection>
      <Alert severity="warning">
        后台展示的固定嵌入地址只是入口基地址，不能直接作为免登录 iframe 地址使用。
      </Alert>
    </Stack>
  );
}

function CodeGuide({ platformOrigin }: { platformOrigin: string }) {
  const baseUrl = platformOrigin || "https://support.example.com";
  const backendExample = `const basic = Buffer.from(\`${"${CLIENT_ID}:${CLIENT_SECRET}"}\`).toString("base64");

const response = await fetch(
  "${baseUrl}/api/v1/integrations/universal/launch-tickets",
  {
    method: "POST",
    headers: {
      Authorization: \`Basic ${"${basic}"}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      user: {
        id: String(currentUser.id),
        name: currentUser.name,
        email: currentUser.email,
      },
      context: {
        theme: "system",
        locale: "zh-CN",
        returnOrigin: "https://app.example.com",
      },
    }),
  },
);

const { data } = await response.json();
return data.launchUrl;`;
  const browserExample = `const iframe = document.querySelector("#achord-ticket");
iframe.src = launchUrl;

window.addEventListener("message", (event) => {
  if (event.origin !== "${baseUrl}") return;
  if (event.data?.source !== "achord-connect-v1") return;
  if (event.data.type === "height") {
    iframe.style.height = \`${"${event.data.height}"}px\`;
  }
});`;

  return (
    <Stack spacing={2.5}>
      <GuideSection title="第三方后端：创建一次性票据">
        <CodeBlock value={backendExample} />
      </GuideSection>
      <GuideSection title="第三方前端：设置 iframe">
        <CodeBlock value={browserExample} />
      </GuideSection>
      <Typography variant="caption" color="text.secondary">
        用户 ID 必须作为字符串提交。配置多个 Origin 时，returnOrigin 必填且必须与当前宿主一致。
      </Typography>
    </Stack>
  );
}

function BoundaryGuide() {
  return (
    <Stack spacing={2.5}>
      <GuideSection title="当前支持">
        <RequirementList
          items={[
            "拥有自身登录体系和可信后端的第三方网页产品。",
            "由第三方后端创建短期单次票据，再将完整工单门户嵌入 iframe。",
            "外部用户只访问自己的工单，不创建平台正式账号。",
            "支持公开回复、附件、在线状态、输入提示、未读事件和可选 Webhook。",
          ]}
        />
      </GuideSection>
      <GuideSection title="当前不支持">
        <RequirementList
          tone="error"
          items={[
            "没有可信后端时，把 Client Secret 直接放进网页或 App。",
            "直接使用固定嵌入地址绕过一次性票据。",
            "原生 App 在没有 HTTPS Origin 的情况下使用当前 iframe 模式。",
            "通过 file://、null Origin 或自定义协议伪装可信网页来源。",
          ]}
        />
      </GuideSection>
      <Alert severity="info">
        原生 App 需要单独的 Native Launch 模式：App 后端创建票据，App
        使用系统浏览器、Custom Tabs 或 WebView 打开临时地址。当前版本尚未提供该模式。
      </Alert>
    </Stack>
  );
}

function GuideSection({ title, children }: { title: string; children: ReactNode }) {
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

function CodeBlock({ value }: { value: string }) {
  return (
    <Box sx={{ position: "relative", minWidth: 0 }}>
      <Tooltip title="复制代码">
        <IconButton
          aria-label="复制代码"
          size="small"
          onClick={() => void navigator.clipboard.writeText(value)}
          sx={{ position: "absolute", top: 6, right: 6, zIndex: 1 }}
        >
          <ContentCopyOutlinedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 1.5,
          pr: 5,
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
        {value}
      </Box>
    </Box>
  );
}
