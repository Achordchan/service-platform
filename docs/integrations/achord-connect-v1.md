# Achord Connect v1

Achord Connect v1 用于把 Achord 的完整工单门户嵌入已经拥有登录体系的第三方产品。第三方用户不会成为 Achord 正式账号，也不会获得客户空间、项目资料或其他用户工单的访问权限。

支持两种打开方式：

- **iframe 模式**（默认）：第三方 HTTPS 网页把门户嵌入 iframe，兑换票据时校验真实父页面 Origin。
- **Native Launch 模式**：桌面或移动 App（例如 Tauri 客户端，界面来源是 `tauri://localhost` / `http://tauri.localhost`，不是 HTTPS 网站）由 App 后端创建票据，在 App 自己的窗口、系统浏览器或 WebView 中**顶层**打开门户，不经过 iframe，也不做父页面来源校验。见下文「原生 App（Native Launch）」。

## 五分钟接入

1. 在插件中心检测并启用“通用工单连接器”，创建“外部接入项目”，在项目内填写允许嵌入的 Origin。
2. 生成 Client ID 和 Client Secret。Secret 只显示一次，只能保存到第三方后端。
3. 第三方用户登录后，由第三方后端请求：

```http
POST /api/v1/integrations/universal/launch-tickets
Authorization: Basic base64(clientId:clientSecret)
Content-Type: application/json

{
  "user": {
    "id": "user-42",
    "name": "张三",
    "email": "user@example.com"
  },
  "context": {
    "theme": "system",
    "locale": "zh-CN",
    "returnOrigin": "https://app.example.com"
  }
}
```

4. 将响应中的 `launchUrl` 立即设置为 iframe 的 `src`。票据 60 秒后过期且只能兑换一次。
5. 监听来自已配置 Achord Origin 的 `postMessage`，按 `height` 调整 iframe 高度，按 `unread-changed` 更新第三方页面的未读标记。

Node、Go、PHP 示例都提供 `createLaunchTicket`、iframe HTML helper 和 Webhook 签名校验。SDK 源码位于 `examples/integrations`，可直接复制进第三方后端；Client Secret 不得进入浏览器代码。

```ts
window.addEventListener("message", (event) => {
  if (event.origin !== "https://support.achord.cn") return;
  if (event.data?.source !== "achord-connect-v1") return;
  if (event.data.type === "height") iframe.style.height = `${event.data.height}px`;
});
```

## 用户字段

固定字段：

| 字段 | 必填 | 限制 |
|---|---:|---|
| `id` | 是 | 只能是字符串，1-191 字符；连接内稳定且唯一，64 位整数也必须按字符串提交 |
| `name` | 是 | 1-160 字符 |
| `email` | 否 | 合法邮箱，最长 320 字符 |
| `username` | 否 | 最长 160 字符 |
| `avatarUrl` | 否 | 生产环境必须为 HTTPS |
| `attributes` | 否 | 只能提交连接中已声明的字段 |

每个连接最多声明 10 个自定义字段，类型为 `text`、`number`、`boolean` 或 `date`。未声明字段、保留关键字、类型不匹配和超限值会返回 422。

`context.returnOrigin` 必须是连接允许列表中的完整 Origin。连接配置多个 Origin 时该字段必填；只有一个 Origin 时服务端可以自动补全。该值由第三方后端提交，用于邮件返回入口和 iframe 宿主校验，不能从浏览器参数临时推断。

`context.launchMode` 可选，取值 `iframe`（默认）或 `native`。`native` 票据不使用也不接受 `returnOrigin`。

## 原生 App（Native Launch）

1. 在项目「外部接入」的连接配置里开启 **允许原生应用启动（Native Launch）**，保存后重新执行连接检测并激活。只做原生接入时可以不填任何 Origin。开关的每次变更都会撤销该连接现有会话，并要求重新检测。
2. App 后端（持有 Client Secret）为已登录用户创建票据：

```http
POST /api/v1/integrations/universal/launch-tickets
Authorization: Basic base64(clientId:clientSecret)
Content-Type: application/json

{
  "user": { "id": "user-42", "name": "张三" },
  "context": { "launchMode": "native", "theme": "system", "locale": "zh-CN" }
}
```

响应仍是 `{ "data": { "launchUrl", "expiresAt" } }`，`launchUrl` 形如：

```text
https://support.achord.cn/embed/connect/<publicId>#ticket=act_…&mode=native
```

3. App 把 `launchUrl` 原样交给自己的独立窗口、系统浏览器或 WebView **顶层**打开，不要放进 iframe，也不要去掉片段里的 `mode=native`。票据同样只放在 URL 片段里、60 秒过期、只能兑换一次；门户打开后立即清掉片段，会话存进页面的 sessionStorage，刷新可以恢复。
4. 可选：在页面脚本运行前向 WebView 注入 `window.AchordConnectNative`，接收与 iframe 模式相同的事件：

```ts
window.AchordConnectNative = {
  postMessage(message: string) {
    const event = JSON.parse(message);
    if (event.source !== "achord-connect-v1") return;
    switch (event.type) {
      case "ready": break;
      case "unread-changed": updateBadge(event.unreadCount); break; // 该用户全部请求的未读总数
      case "session-expired": showReopenHint(); break;
      case "close-requested": closeSupportWindow(); break;
    }
  },
};
```

参数是 JSON 字符串：`{ "source": "achord-connect-v1", "type": "ready" | "unread-changed" | "session-expired" | "close-requested", ...数据 }`。没有桥接对象时门户静默跳过。

门户在 Native 模式下的行为：

- 右上角提供「关闭」按钮：有桥接时发送 `close-requested`，由宿主关窗；没有桥接时调用 `window.close()`，关不掉时提示「请直接关闭此窗口」。
- 会话过期（最长 2 小时、不续期）时页面提示「会话已过期，请关闭此窗口后从应用中重新打开工单。」并发送 `session-expired`。App 需要重新创建票据再打开。
- 消息中的外部链接和附件下载都以新窗口（`target=_blank`）打开，宿主可以把新窗口转交系统浏览器。附件使用 60 秒有效、只绑定当前会话和该附件的签名链接，系统浏览器不需要登录态。

服务端只按**票据上存的** `launchMode` 决定是否跳过父页面来源校验：把 iframe 票据的片段改成 `mode=native` 只会让门户不带父页面来源去兑换，随即被服务端拒绝。

## 查询联系人未读数

接入方启动时，或怀疑漏收 Webhook 后，可以在服务端重新同步「工单」按钮上的未读红点：

```http
GET /api/v1/integrations/universal/contacts/{externalUserId}/unread
Authorization: Basic base64(clientId:clientSecret)
```

```json
{
  "data": {
    "externalUserId": "user-42",
    "unreadCount": 3,
    "requests": [
      { "id": "…", "number": "SR-20260928-001", "title": "无法连接", "status": "WAITING_CUSTOMER", "unreadCount": 2, "updatedAt": "2026-09-28T02:00:00.000Z" }
    ]
  }
}
```

- 只返回当前凭据所属连接下的联系人；`requests` 只含有未读的请求，按 `updatedAt` 倒序，最多 50 条；`unreadCount` 是全部请求的未读总数（与门户 `unread-changed` 口径一致）。
- 联系人不存在时同样返回 200、`unreadCount: 0`、`requests: []`，不泄露该用户是否来过。
- 每个连接每分钟 600 次，超出返回 429 `UNIVERSAL_RATE_LIMITED`。
- `externalUserId` 需要做 URL 编码。

## iframe 消息

Native Launch 模式不发送 iframe 消息，改走上文的 `window.AchordConnectNative`（没有 `height`）。

Achord 只向已配置且与真实父页面匹配的 Origin 发送：

| 类型 | 数据 |
|---|---|
| `ready` | 无 |
| `height` | `height`，页面像素高度 |
| `unread-changed` | `unreadCount` |
| `session-expired` | 无 |

消息不包含工单正文、附件、用户令牌或 Embed Session。父页面也不需要向 iframe 发送身份信息。

## 凭据轮换

一个连接最多同时保留两个有效凭据。先生成新凭据并部署到第三方后端，确认新凭据能创建票据，再撤销旧凭据。撤销不会删除工单历史，但旧凭据不能再创建票据。

## Webhook

可订阅 `request.created`、`request.public_message.created`、`request.status.changed` 和 `request.unread.changed`。签名内容为 `timestamp.rawBody`，使用 Webhook Secret 计算 HMAC-SHA256：

```text
X-Achord-Event-Id: 事件唯一 ID
X-Achord-Timestamp: Unix 秒
X-Achord-Signature: v1=十六进制签名
```

`request.unread.changed` 的 `data` 包含：`externalUserId`、`unreadCount`（该请求的未读数）、`contactUnreadCount`（该联系人全部请求的未读总数，新增字段，老接入方可忽略）和 `request`。

接收端必须在读取 JSON 前保留原始正文，拒绝超过五分钟的时间戳，并对事件 ID 建唯一索引。返回非 2xx、重定向、超时或网络错误会按 1 分钟、5 分钟、30 分钟、2 小时、12 小时重试。

## 邮件通知

外部联系人邮件里的「返回原系统」链接指向联系人最近一次以 iframe 进入时的父页面 Origin，或连接唯一的 Origin。联系人只用过 Native Launch、连接也没有可确定的 Origin 时，邮件不放链接，改为提示「请在应用内打开工单查看回复」，不会生成指向错误站点的链接。

## 错误码

| HTTP | 错误码 | 含义 |
|---:|---|---|
| 401 | `UNIVERSAL_CREDENTIAL_INVALID` | 凭据错误、已撤销或连接未激活 |
| 401 | `UNIVERSAL_TICKET_INVALID` | 票据错误、过期或连接不可用 |
| 401 | `UNIVERSAL_TICKET_CONSUMED` | 票据已兑换 |
| 403 | `EXTERNAL_CONTACT_BLOCKED` | 外部联系人已停用 |
| 403 | `UNIVERSAL_NATIVE_LAUNCH_DISABLED` | 连接未开启 Native Launch，却创建或兑换 native 票据 |
| 403 | `UNIVERSAL_PARENT_ORIGIN_INVALID` / `UNIVERSAL_PARENT_ORIGIN_MISMATCH` | iframe 票据的父页面来源不在允许列表或与票据不一致 |
| 409 | `UNIVERSAL_IFRAME_NOT_CONFIGURED` | 连接没有配置 Origin，只能创建 native 票据 |
| 409 | `EXTERNAL_PROJECT_READ_ONLY` | 项目当前只读 |
| 422 | `UNDECLARED_PROFILE_ATTRIBUTE` | 提交了未声明资料字段 |
| 422 | `INVALID_PROFILE_ATTRIBUTE` | 自定义字段类型错误 |
| 422 | `UNIVERSAL_RETURN_ORIGIN_REQUIRED` | 多 Origin 连接未指定可信返回 Origin |
| 422 | `UNIVERSAL_RETURN_ORIGIN_NOT_ALLOWED_FOR_NATIVE` | native 票据传了 `returnOrigin` |
| 422 | `UNIVERSAL_PARENT_ORIGIN_REQUIRED` | 兑换 iframe 票据时缺少父页面来源 |
| 413 | `REQUEST_BODY_TOO_LARGE` | JSON 请求体超过 64KB |
| 429 | `UNIVERSAL_RATE_LIMITED` | 签票每连接 300 次 / 每用户 20 次、未读查询每连接 600 次的一分钟限流 |

完整请求结构见 [OpenAPI](./openapi.yaml)，安全和产品边界见 [安全边界](./security-boundaries.md)。
