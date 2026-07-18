# Achord Connect v1

Achord Connect v1 用于把 Achord 的完整工单门户嵌入已经拥有登录体系的第三方产品。第三方用户不会成为 Achord 正式账号，也不会获得客户空间、项目资料或其他用户工单的访问权限。

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

## iframe 消息

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

接收端必须在读取 JSON 前保留原始正文，拒绝超过五分钟的时间戳，并对事件 ID 建唯一索引。返回非 2xx、重定向、超时或网络错误会按 1 分钟、5 分钟、30 分钟、2 小时、12 小时重试。

## 错误码

| HTTP | 错误码 | 含义 |
|---:|---|---|
| 401 | `UNIVERSAL_CREDENTIAL_INVALID` | 凭据错误、已撤销或连接未激活 |
| 401 | `UNIVERSAL_TICKET_INVALID` | 票据错误、过期或连接不可用 |
| 401 | `UNIVERSAL_TICKET_CONSUMED` | 票据已兑换 |
| 403 | `EXTERNAL_CONTACT_BLOCKED` | 外部联系人已停用 |
| 409 | `EXTERNAL_PROJECT_READ_ONLY` | 项目当前只读 |
| 422 | `UNDECLARED_PROFILE_ATTRIBUTE` | 提交了未声明资料字段 |
| 422 | `INVALID_PROFILE_ATTRIBUTE` | 自定义字段类型错误 |
| 422 | `UNIVERSAL_RETURN_ORIGIN_REQUIRED` | 多 Origin 连接未指定可信返回 Origin |
| 413 | `REQUEST_BODY_TOO_LARGE` | JSON 请求体超过 64KB |
| 429 | `UNIVERSAL_RATE_LIMITED` | 每连接或每用户超过一分钟限流 |

完整请求结构见 [OpenAPI](./openapi.yaml)，安全和产品边界见 [安全边界](./security-boundaries.md)。
