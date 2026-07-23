import assert from "node:assert/strict";
import test from "node:test";
import {
  DingTalkRobotDeliveryError,
  sendDingTalkTicketNotification,
  testDingTalkRobotBinding,
} from "../src/runtime";

const webhookUrl =
  "https://oapi.dingtalk.com/robot/send?access_token=secret-token";

test("sends a Chinese Markdown notification with the required keyword", async () => {
  let requestBody = "";
  const result = await sendDingTalkTicketNotification(
    { webhookUrl },
    {
      type: "REQUEST_CREATED",
      requestId: "request-1",
      requestNumber: "REQ-1001",
      title: "无法登录\n请处理",
      requestUrl: "https://support.example.com/staff/requests/request-1",
      customerName: "示例客户",
      projectName: "示例项目",
      priorityLabel: "高",
      actorName: "张三",
      occurredAt: "2026-07-22T02:30:00.000Z",
    },
    {
      fetch: async (_input, init) => {
        requestBody = String(init?.body ?? "");
        return Response.json({ errcode: 0, errmsg: "ok" });
      },
    },
  );

  assert.deepEqual(result, { delivered: true });
  const body = JSON.parse(requestBody) as {
    msgtype: string;
    markdown: { title: string; text: string };
    at: { isAtAll: boolean };
  };
  assert.equal(body.msgtype, "markdown");
  assert.match(body.markdown.title, /工单通知/);
  assert.match(body.markdown.text, /REQ\\-1001/);
  assert.doesNotMatch(body.markdown.text, /\n请处理/);
  assert.equal(body.at.isAtAll, false);
});

test("test binding sends a visible success message", async () => {
  let requestBody = "";
  let redirect: RequestRedirect | undefined;
  await testDingTalkRobotBinding(
    { webhookUrl },
    {
      fetch: async (_input, init) => {
        requestBody = String(init?.body ?? "");
        redirect = init?.redirect;
        return Response.json({ errcode: 0, errmsg: "ok" });
      },
    },
  );

  assert.match(requestBody, /工单通知/);
  assert.match(requestBody, /绑定成功/);
  assert.equal(redirect, "error");
});

test("renders an event template while preserving the required keyword", async () => {
  let requestBody = "";
  await sendDingTalkTicketNotification(
    { webhookUrl },
    {
      type: "REQUEST_CUSTOMER_REPLIED",
      requestId: "request-1",
      requestNumber: "REQ-1001",
      title: "VPN 连接失败",
      requestUrl: "https://support.example.com/staff/requests/request-1",
      customerName: "示例客户",
      actorName: "李四",
      occurredAt: "2026-07-23T02:30:00.000Z",
    },
    {
      template: {
        title: "{{customerName}} 回复了 {{requestNumber}}",
        body: "回复人：{{actorName}}\n不存在的可选项：{{projectName}}",
      },
      fetch: async (_input, init) => {
        requestBody = String(init?.body ?? "");
        return Response.json({ errcode: 0, errmsg: "ok" });
      },
    },
  );

  const body = JSON.parse(requestBody) as {
    markdown: { title: string; text: string };
  };
  assert.match(body.markdown.title, /工单通知：示例客户 回复了 REQ\\-1001/);
  assert.match(body.markdown.text, /回复人：李四/);
  assert.doesNotMatch(body.markdown.text, /不存在的可选项/);
});

test("rejects non-HTTPS public request links", async () => {
  await assert.rejects(() =>
    sendDingTalkTicketNotification(
      { webhookUrl },
      {
        type: "REQUEST_CREATED",
        requestId: "request-1",
        requestNumber: "REQ-1001",
        title: "测试工单",
        requestUrl: "http://support.example.com/staff/requests/request-1",
        occurredAt: new Date(),
      },
      { fetch: async () => Response.json({ errcode: 0 }) },
    ),
  );
});

test("reports HTTP failures without reading untrusted response details", async () => {
  await assert.rejects(
    () =>
      testDingTalkRobotBinding(
        { webhookUrl },
        { fetch: async () => new Response("secret body", { status: 503 }) },
      ),
    (error: unknown) => {
      assert.ok(error instanceof DingTalkRobotDeliveryError);
      assert.equal(error.code, "HTTP_ERROR");
      assert.doesNotMatch(error.message, /secret body/);
      return true;
    },
  );
});

test("aborts a stalled DingTalk request at the configured timeout", async () => {
  await assert.rejects(
    () =>
      testDingTalkRobotBinding(
        { webhookUrl },
        {
          timeoutMs: 1_000,
          fetch: async (_input, init) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => {
                reject(new DOMException("aborted", "AbortError"));
              });
            }),
        },
      ),
    (error: unknown) => {
      assert.ok(error instanceof DingTalkRobotDeliveryError);
      assert.equal(error.code, "TIMEOUT");
      return true;
    },
  );
});

test("does not expose tokens when DingTalk rejects a message", async () => {
  await assert.rejects(
    () =>
      sendDingTalkTicketNotification(
        { webhookUrl },
        {
          type: "REQUEST_CUSTOMER_REPLIED",
          requestId: "request-1",
          requestNumber: "REQ-1001",
          title: "客户回复",
          requestUrl: "https://support.example.com/staff/requests/request-1",
          occurredAt: new Date(),
        },
        {
          fetch: async () =>
            Response.json({
              errcode: 310000,
              errmsg: "failed access_token=secret-token&sign=secret-sign",
            }),
        },
      ),
    (error: unknown) => {
      assert.ok(error instanceof DingTalkRobotDeliveryError);
      assert.equal(error.code, "DINGTALK_REJECTED");
      assert.doesNotMatch(error.message, /secret-token/);
      assert.doesNotMatch(error.message, /secret-sign/);
      return true;
    },
  );
});

test("rejects oversized responses", async () => {
  await assert.rejects(
    () =>
      testDingTalkRobotBinding(
        { webhookUrl },
        {
          fetch: async () =>
            new Response("x".repeat(17 * 1024), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
        },
      ),
    (error: unknown) => {
      assert.ok(error instanceof DingTalkRobotDeliveryError);
      assert.equal(error.code, "INVALID_RESPONSE");
      return true;
    },
  );
});
