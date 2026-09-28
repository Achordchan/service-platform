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
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";

export type UniversalGuideStage =
  | "CONFIGURE"
  | "CREDENTIALS"
  | "ACTIVATE"
  | "ACTIVE";

const stageMessages: Record<UniversalGuideStage, string> = {
  CONFIGURE: "当前下一步：填写第三方网页的 HTTPS Origin（或开启原生应用启动）并保存连接配置。",
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

  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down("sm"));

  function closeDialog() {
    setTab(0);
    onClose();
  }

  return (
    <Dialog open={open} onClose={closeDialog} fullWidth maxWidth="md" fullScreen={mobile}>
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
            <Tab label="原生 App（Native Launch）" />
            <Tab label="产品边界" />
          </Tabs>
          <Divider />
          {tab === 0 ? <QuickStartGuide /> : null}
          {tab === 1 ? <CodeGuide platformOrigin={platformOrigin} /> : null}
          {tab === 2 ? <NativeLaunchGuide platformOrigin={platformOrigin} /> : null}
          {tab === 3 ? <BoundaryGuide /> : null}
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
          至少配置一个 Origin（或开启原生应用启动）和一个有效凭据后执行连接检测。Webhook
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

function NativeLaunchGuide({ platformOrigin }: { platformOrigin: string }) {
  const baseUrl = platformOrigin || "https://support.example.com";
  const backendExample = `// App 后端（持有 Client Secret）：为已登录用户创建 native 票据
const basic = Buffer.from(\`${"${CLIENT_ID}:${CLIENT_SECRET}"}\`).toString("base64");

const response = await fetch(
  "${baseUrl}/api/v1/integrations/universal/launch-tickets",
  {
    method: "POST",
    headers: {
      Authorization: \`Basic ${"${basic}"}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      user: { id: String(currentUser.id), name: currentUser.name },
      // native 票据不能带 returnOrigin
      context: { launchMode: "native", theme: "system", locale: "zh-CN" },
    }),
  },
);
const { data } = await response.json();
// data.launchUrl 形如 ${baseUrl}/embed/connect/<publicId>#ticket=act_…&mode=native
return data.launchUrl;`;
  const appExample = `// App 端：拿到 launchUrl 后原样顶层打开（独立窗口 / 系统浏览器 / WebView），不要放进 iframe。
// 可选：在页面加载前注入桥接对象，接收门户事件
window.AchordConnectNative = {
  postMessage(message) {
    const event = JSON.parse(message);
    if (event.source !== "achord-connect-v1") return;
    if (event.type === "unread-changed") updateBadge(event.unreadCount);
    if (event.type === "session-expired") showReopenHint();
    if (event.type === "close-requested") closeSupportWindow();
  },
};`;
  const unreadExample = `// App 后端：启动时或 Webhook 丢失后重建「工单」按钮红点
const response = await fetch(
  \`${baseUrl}/api/v1/integrations/universal/contacts/${"${encodeURIComponent(userId)}"}/unread\`,
  { headers: { Authorization: \`Basic ${"${basic}"}\` } },
);
const { data } = await response.json(); // { externalUserId, unreadCount, requests }`;

  return (
    <Stack spacing={2.5}>
      <Typography variant="body2" color="text.secondary">
        桌面或移动 App 没有 HTTPS 网页来源，不能走 iframe 模式。先在连接配置里开启“允许原生应用启动（Native
        Launch）”，保存后重新执行连接检测。只做原生接入时可以不填 Origin。
      </Typography>
      <GuideSection title="1. App 后端创建 native 票据">
        <Typography variant="body2" color="text.secondary">
          与网页接入同一个接口，context.launchMode 传 &quot;native&quot;。票据同样 60 秒有效、只能兑换一次，只放在
          URL 片段里。
        </Typography>
        <CodeBlock value={backendExample} />
      </GuideSection>
      <GuideSection title="2. App 顶层打开 launchUrl">
        <Typography variant="body2" color="text.secondary">
          在 App 的独立窗口、系统浏览器或 WebView 中原样打开 launchUrl，不要去掉片段里的 mode=native。门户右上角提供“关闭”按钮；附件和外部链接会以新窗口打开，宿主可把新窗口交给系统浏览器处理。
        </Typography>
      </GuideSection>
      <GuideSection title="3. 可选：注入 window.AchordConnectNative 接收事件">
        <Typography variant="body2" color="text.secondary">
          门户会把 ready、unread-changed（unreadCount 为该用户全部请求的未读总数）、session-expired、close-requested
          以 JSON 字符串传给 postMessage。没有桥接对象时门户静默跳过。
        </Typography>
        <CodeBlock value={appExample} />
      </GuideSection>
      <GuideSection title="4. 服务端同步未读数">
        <CodeBlock value={unreadExample} />
      </GuideSection>
      <Alert severity="warning">
        会话最长 2 小时、不续期。过期后门户会提示用户关闭窗口，App 需要重新创建票据再打开。
      </Alert>
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
            "由第三方后端创建短期单次票据，再将完整服务请求门户嵌入 iframe。",
            "拥有可信后端的桌面或移动 App：以 Native Launch 模式在 App 窗口、系统浏览器或 WebView 中顶层打开门户。",
            "外部用户只访问自己的服务请求，不创建平台正式账号。",
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
            "通过 file://、null Origin 或自定义协议冒充 iframe 来源。",
          ]}
        />
      </GuideSection>
      <Alert severity="info">
        原生 App 需要单独的 Native Launch 模式：在连接配置中开启后，由 App 后端以 launchMode:
        &quot;native&quot; 创建票据，App 在独立窗口、系统浏览器或 WebView 中顶层打开 launchUrl。详见“原生
        App（Native Launch）”一节。
      </Alert>
    </Stack>
  );
}

function GuideSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack spacing={1.25}>
      <Typography sx={{ fontWeight: 650 }}>{title}</Typography>
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
