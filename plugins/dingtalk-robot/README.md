# 钉钉机器人通知插件

插件提供后台出站通知：新工单或客户公开回复发生后，由宿主按后台通知规则写入事务化 Outbox，插件通过钉钉群自定义机器人 Webhook 发送可配置的中文 Markdown 消息。

## 管理员配置

1. 在后台只填写钉钉机器人 Webhook 地址。
2. 钉钉机器人的安全设置选择“自定义关键词”，关键词填写 `工单通知`。
3. 在插件中心保存 Webhook。保存敏感配置会保持插件关闭，并清除旧健康结果。
4. 点击“运行环境检测”，宿主只校验配置和插件运行时，不向钉钉群发送消息。
5. 需要确认群连接时，管理员可单独点击“发送测试消息”。
6. 在“钉钉通知模板”中编辑标题和 Markdown 正文，可预览、恢复默认或发送单个模板测试。
7. 检测通过后启用插件。
8. 在“设置 → 通知规则”中分别开启“新建服务请求”和“公开回复”的钉钉机器人通道。

Webhook 含访问令牌，宿主必须使用平台加密存储，不能保存到 `PluginInstallation.config`、环境变量、日志、审计详情或前端回显中。

## 宿主调用

```ts
import {
  sendDingTalkTicketNotification,
  testDingTalkRobotBinding,
} from "@achord/plugin-dingtalk-robot/runtime";

await testDingTalkRobotBinding({ webhookUrl });

await sendDingTalkTicketNotification(
  { webhookUrl },
  {
    type: "REQUEST_CREATED",
    requestId: request.id,
    requestNumber: request.number,
    title: request.title,
    requestUrl,
    customerName,
    projectName,
    priorityLabel,
    actorName,
    occurredAt: new Date(),
  },
);
```

支持事件：

- `REQUEST_CREATED`：新工单待处理。
- `REQUEST_CUSTOMER_REPLIED`：客户公开回复，后台需要继续处理。

邮件与钉钉是两个独立通道。同一场景只开启钉钉时仅发送钉钉；同时开启邮件和钉钉时两个 Outbox 独立投递，任一通道失败不会阻断另一通道。钉钉不受邮件“未读 5 分钟后发送”开关影响。

插件不会发送工单正文、附件、Webhook 或其他敏感数据；网络请求固定为 HTTPS 钉钉官方机器人域名，超时 8 秒，不在插件内无限重试。

宿主在新工单和客户公开回复的业务事务中写入幂等 Outbox，再由 pg-boss 异步发送。首次失败后按 1 分钟、5 分钟、30 分钟和 2 小时重试，最多尝试 5 次；分钟级 Sweep 会恢复漏入队或进程中断的任务。发送失败不会阻断工单创建或回复事务。

## 当前宿主接入

- 根应用直接声明当前 workspace 插件依赖，并在白名单注册。
- Webhook 使用宿主加密字段保存，前端只显示“已配置”，不会回显原值。
- 健康检测不得向钉钉群发送消息；Webhook 格式由配置解析器校验，插件运行时由宿主加载检测。
- `testDingTalkRobotBinding` 只由单独、明确标注的“发送测试消息”操作调用，不能绑定到保存、检测或启用流程。
- 支持 `REQUEST_CREATED` 和 `REQUEST_CUSTOMER_REPLIED` 两类业务事件。
- 每类事件有独立模板；事件发生时模板会写入 Outbox 快照，排队期间修改模板不会改变已经产生的消息。
- 通知规则关闭后不会创建新投递，并将尚未开始发送的同类任务标记为跳过；不会补发历史事件。
- 停用插件会将待处理或处理中投递标记为跳过，后续业务事件不再创建 Outbox。
