import assert from "node:assert/strict";
import test from "node:test";
import {
  DINGTALK_ROBOT_DEFAULT_CONFIG,
  DingTalkRobotConfigError,
  parseDingTalkRobotBinding,
  parseDingTalkRobotConfig,
  parseDingTalkRobotTemplate,
} from "../src/config";

const validWebhook =
  "https://oapi.dingtalk.com/robot/send?access_token=test-token";

test("parses a copied DingTalk robot webhook", () => {
  assert.deepEqual(
    parseDingTalkRobotBinding({ webhookUrl: `  ${validWebhook}  ` }),
    { webhookUrl: validWebhook },
  );
});

test("rejects non-HTTPS and lookalike hosts", () => {
  for (const webhookUrl of [
    "http://oapi.dingtalk.com/robot/send?access_token=test-token",
    "https://oapi.dingtalk.com.evil.example/robot/send?access_token=test-token",
  ]) {
    assert.throws(
      () => parseDingTalkRobotBinding({ webhookUrl }),
      DingTalkRobotConfigError,
    );
  }
});

test("rejects missing token and unexpected paths", () => {
  for (const webhookUrl of [
    "https://oapi.dingtalk.com/robot/send",
    "https://oapi.dingtalk.com/other?access_token=test-token",
  ]) {
    assert.throws(
      () => parseDingTalkRobotBinding({ webhookUrl }),
      DingTalkRobotConfigError,
    );
  }
});

test("fills default notification templates for existing empty config", () => {
  assert.deepEqual(parseDingTalkRobotConfig({}), DINGTALK_ROBOT_DEFAULT_CONFIG);
});

test("upgrades untouched legacy default templates without overwriting custom templates", () => {
  const legacy = structuredClone(DINGTALK_ROBOT_DEFAULT_CONFIG);
  legacy.templates.REQUEST_CUSTOMER_REPLIED.body = [
    "- **服务请求**：{{requestNumber}} {{requestTitle}}",
    "- **客户**：{{customerName}}",
    "- **项目**：{{projectName}}",
    "- **回复人**：{{actorName}}",
    "- **时间**：{{occurredAt}}",
  ].join("\n");
  legacy.templates.CONTENT_RISK_ALERT.body = [
    "- **位置**：{{targetLabel}}",
    "- **摘要**：{{riskSummary}}",
    "- **时间**：{{occurredAt}}",
    "",
    "原始内容仅可在平台受限风控记录中查看。",
  ].join("\n");

  assert.deepEqual(parseDingTalkRobotConfig(legacy), DINGTALK_ROBOT_DEFAULT_CONFIG);

  legacy.templates.REQUEST_CUSTOMER_REPLIED.title = "我的客户回复模板";
  assert.equal(
    parseDingTalkRobotConfig(legacy).templates.REQUEST_CUSTOMER_REPLIED.title,
    "我的客户回复模板",
  );
});

test("accepts customized templates and rejects unknown variables", () => {
  const customized = structuredClone(DINGTALK_ROBOT_DEFAULT_CONFIG);
  customized.templates.REQUEST_CREATED.title =
    "{{projectName}} 有新工单";
  assert.equal(
    parseDingTalkRobotConfig(customized).templates.REQUEST_CREATED.title,
    "{{projectName}} 有新工单",
  );

  customized.templates.REQUEST_CREATED.body = "{{unknownVariable}}";
  assert.throws(
    () => parseDingTalkRobotConfig(customized),
    DingTalkRobotConfigError,
  );
});

test("validates a queued template snapshot independently", () => {
  assert.deepEqual(
    parseDingTalkRobotTemplate({ title: "新工单", body: "{{requestNumber}}" }),
    { title: "新工单", body: "{{requestNumber}}" },
  );
  assert.throws(
    () =>
      parseDingTalkRobotTemplate({
        title: "新工单",
        body: "{{unsupported}}",
      }),
    DingTalkRobotConfigError,
  );
});
