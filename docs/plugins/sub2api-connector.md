# Sub2API 工单连接器

`sub2api-connector` 是默认关闭的可信构建期插件。它只为 `EXTERNAL_INTEGRATION` 项目提供嵌入工单能力，不改变标准项目的登录、邀请、客户空间和成员关系。

## 启用流程

1. 在插件中心执行环境检测并启用“Sub2API 工单连接器”。
2. 创建“外部接入项目”，进入项目详情的“外部接入”标签。
3. 填写 Sub2API HTTPS 地址；管理员 API Key 仅用于补充用户资料，可以留空。
4. 保存后执行连接检测，检测通过后激活连接。
5. 将系统生成的 iframe 地址配置到 Sub2API 用户侧自定义菜单。

Sub2API 应向 iframe 地址追加：

```text
user_id、token、theme、lang、ui_mode、src_host、src_url
```

`token` 必须是当前 Sub2API 用户的 JWT。工单系统会调用同一实例的 `/api/v1/auth/me`，并要求返回 ID 与 `user_id` 完全一致；管理员 API Key 不能替代这一步。

## 身份和权限

- 外部用户保存为 `ExternalContact`，不会创建 Better Auth 用户、密码、Membership 或客户空间席位。
- 每个外部联系人只能读取自己创建的工单、公开消息和公开附件。
- 正常受邀客户成员仍按主站权限查看该项目全部工单。
- 嵌入会话最长两小时，且不会超过 JWT 剩余有效期。
- 插件停用、连接停用或归档、联系人被停用时，会话立即撤销；现有 SSE 会在下一次 25 秒健康检查前关闭。

## 网络和密钥

- 生产环境只接受 HTTPS 地址，并拒绝本机、内网、链路本地地址和跨 Origin 重定向。
- 每次请求都限制为已保存 Origin，超时 6 秒，响应体不超过 1MB。
- 管理员 API Key 使用平台 AES-256-GCM 主密钥加密，只显示“已配置”，不回显原值。
- JWT 只用于单次兑换，不写入数据库、日志、审计或 SSE；工单会话只保存 SHA-256 哈希。

## 反向代理日志

嵌入入口初次加载的查询字符串包含 Sub2API JWT。应用会在客户端启动后立即清理地址栏，但 Nginx/CDN 仍可能记录原始请求，因此生产反向代理必须关闭该路径的查询字符串访问日志，或使用不包含 `$request` / `$request_uri` 的专用日志格式。

示例思路：

```nginx
location ^~ /embed/sub2api/ {
    access_log /var/log/nginx/sub2api_embed.access.log main_no_args;
    proxy_pass http://service_platform;
}
```

必须拆成两段 include：

```nginx
# http {}
include /etc/nginx/snippets/sub2api-embed-log-format.conf;

# server {} for support.achord.cn
include /etc/nginx/snippets/sub2api-embed-location.conf;
```

仓库提供：

- `scripts/nginx-sub2api-embed-log-format.conf`
- `scripts/nginx-sub2api-embed-location.conf`

`scripts/remote-deploy.sh` 会在停止应用服务**之前**安装并校验这两个 snippet（不会把 snippet 自身的匹配算作已生效）。还要求 `/embed/sub2api/` 使用 `main_no_args`；任一条件不满足时部署直接失败，且不会把生产服务停掉。若服务已停止后的后续步骤失败，脚本会通过 EXIT trap 尝试恢复 `service-platform` 与 worker。专用格式只记录 `$uri`，不要记录 `$request_uri`、`$args` 或完整请求行。应用响应会附带 `Cache-Control: no-store`、`Referrer-Policy: no-referrer` 和按连接 Origin 生成的 `frame-ancestors`。

## 回滚

优先在插件中心停用连接器。停用会撤销全部嵌入会话，但不会删除项目、外部联系人、工单、消息或附件；标准项目和主站登录不受影响。
