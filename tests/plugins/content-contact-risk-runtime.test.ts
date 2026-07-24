import { describe, expect, it, vi } from "vitest";
import {
  discoverContentRiskModels,
  getContentContactRiskRuntimeHealth,
  inspectContentRisk,
} from "../../plugins/content-contact-risk/src/runtime";

const config = {
  baseUrl: "https://models.example.com",
  model: "gpt-risk-mini",
  fullAuditEnabled: true,
  allowedDomains: [],
};
const secrets = { apiKey: "test-api-key" };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("联系方式风控模型协议", () => {
  it("从自定义上游 /v1/models 获取并去重模型", async () => {
    const request = vi.fn(async () =>
      jsonResponse({
        data: [
          { id: "gpt-risk-mini" },
          { name: "gpt-risk-pro" },
          { id: "gpt-risk-mini" },
        ],
      }),
    );

    await expect(
      discoverContentRiskModels(config, secrets, { fetch: request }),
    ).resolves.toEqual(["gpt-risk-mini", "gpt-risk-pro"]);
    expect(request).toHaveBeenCalledWith(
      "https://models.example.com/v1/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer test-api-key" },
        redirect: "error",
      }),
    );
  });

  it("Base URL 已包含 /v1 时不会重复拼接版本路径", async () => {
    const request = vi.fn(async () => jsonResponse({ data: ["gpt-risk-mini"] }));

    await discoverContentRiskModels(
      { ...config, baseUrl: "https://models.example.com/gateway/v1/" },
      secrets,
      { fetch: request },
    );

    expect(request).toHaveBeenCalledWith(
      "https://models.example.com/gateway/v1/models",
      expect.any(Object),
    );
  });

  it("模型列表响应无效时返回可识别的上游错误", async () => {
    await expect(
      discoverContentRiskModels(config, secrets, {
        fetch: async () => new Response("not-json"),
      }),
    ).rejects.toMatchObject({
      name: "ContentRiskProviderError",
      message: "上游返回的模型列表不是有效 JSON",
      status: 200,
    });
  });

  it("使用 Responses API 的严格 JSON Schema 并发送多模态附件", async () => {
    const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        stream: boolean;
        input: Array<{
          role: string;
          content: Array<Record<string, unknown>>;
        }>;
        text: { format: Record<string, unknown> };
      };
      expect(body.model).toBe("gpt-risk-mini");
      expect(body.stream).toBe(true);
      expect(body.text.format).toMatchObject({
        type: "json_schema",
        strict: true,
      });
      expect(body.input.map((item) => item.role)).toEqual(["system", "user"]);
      expect(body.input[1]?.content.map((item) => item.type)).toEqual([
        "input_text",
        "input_image",
        "input_file",
        "input_text",
      ]);
      const systemPrompt = body.input[0]?.content[0]?.text;
      expect(systemPrompt).toEqual(expect.any(String));
      expect(systemPrompt).toContain("明确联系方式或“加微信”不得返回 UNCERTAIN");
      expect(systemPrompt).toContain("不可信待检测数据");
      const userPrompt = body.input[1]?.content.find(
        (item) => item.type === "input_text",
      )?.text;
      expect(userPrompt).toContain("<UNTRUSTED_CONTENT>");
      expect(userPrompt).toContain("稍后换个地方聊");
      return jsonResponse({
        id: "response-1",
        output_text: JSON.stringify({
          decision: "UNCERTAIN",
          categories: ["OFF_PLATFORM_GUIDANCE"],
          reason: "存在引导私聊语义，但证据不足",
        }),
      });
    });

    const result = await inspectContentRisk(
      config,
      secrets,
      {
        text: "稍后换个地方聊",
        attachments: [
          {
            fileName: "image.png",
            mimeType: "image/png",
            data: new Uint8Array([1, 2, 3]),
          },
          {
            fileName: "proposal.pdf",
            mimeType: "application/pdf",
            data: new Uint8Array([4, 5, 6]),
          },
          {
            fileName: "notes.txt",
            mimeType: "text/plain",
            data: new TextEncoder().encode("正常附件正文"),
          },
        ],
      },
      { fetch: request },
    );

    expect(result).toEqual({
      result: {
        decision: "UNCERTAIN",
        categories: ["OFF_PLATFORM_GUIDANCE"],
        reason: "存在引导私聊语义，但证据不足",
      },
      providerRequestId: "response-1",
    });
  });

  it("兼容上游返回 Responses API SSE 事件流", async () => {
    const completed = {
      id: "response-sse-1",
      output: [
        {
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                decision: "ALLOW",
                categories: [],
                reason: "未发现风险",
              }),
            },
          ],
        },
      ],
    };
    const stream = [
      "event: response.created",
      'data: {"type":"response.created","response_id":"response-sse-1"}',
      "",
      "event: response.completed",
      `data: ${JSON.stringify({ type: "response.completed", response: completed })}`,
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    await expect(
      inspectContentRisk(config, secrets, { text: "正常消息" }, {
        fetch: async () => new Response(stream, {
          headers: { "Content-Type": "text/event-stream" },
        }),
      }),
    ).resolves.toEqual({
      result: {
        decision: "ALLOW",
        categories: [],
        reason: "未发现风险",
      },
      providerRequestId: "response-sse-1",
    });
  });

  it("从 Sub2API 输出项事件恢复被空完成事件省略的正文", async () => {
    const outputItem = {
      id: "msg-sub2api-1",
      type: "message",
      role: "assistant",
      content: [
        {
          type: "output_text",
          text: JSON.stringify({
            decision: "ALLOW",
            categories: [],
            reason: "未发现风险",
          }),
        },
      ],
    };
    const stream = [
      "event: response.output_item.done",
      `data: ${JSON.stringify({
        type: "response.output_item.done",
        response_id: "response-sub2api-1",
        item: outputItem,
      })}`,
      "",
      "event: response.completed",
      `data: ${JSON.stringify({
        type: "response.completed",
        response: {
          id: "response-sub2api-1",
          status: "completed",
          output: [],
        },
      })}`,
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    await expect(
      inspectContentRisk(config, secrets, { text: "正常消息" }, {
        fetch: async () => new Response(stream, {
          headers: { "Content-Type": "text/event-stream" },
        }),
      }),
    ).resolves.toMatchObject({
      result: { decision: "ALLOW", reason: "未发现风险" },
      providerRequestId: "response-sub2api-1",
    });
  });

  it("兼容包装响应和 Chat Completions 文本结构", async () => {
    const decision = JSON.stringify({
      decision: "ALLOW",
      categories: [],
      reason: "未发现风险",
    });

    await expect(
      inspectContentRisk(config, secrets, { text: "正常消息" }, {
        fetch: async () => jsonResponse({
          data: {
            id: "response-wrapped-1",
            choices: [{ message: { content: decision } }],
          },
        }),
      }),
    ).resolves.toMatchObject({
      result: { decision: "ALLOW", reason: "未发现风险" },
      providerRequestId: "response-wrapped-1",
    });
  });

  it("兼容没有 type 的扁平 Responses 输出项", async () => {
    await expect(
      inspectContentRisk(config, secrets, { text: "正常消息" }, {
        fetch: async () => jsonResponse({
          id: "response-flat-1",
          status: "completed",
          output: [
            {
              role: "assistant",
              content: JSON.stringify({
                decision: "ALLOW",
                categories: [],
                reason: "未发现风险",
              }),
            },
          ],
        }),
      }),
    ).resolves.toMatchObject({
      result: { decision: "ALLOW", reason: "未发现风险" },
      providerRequestId: "response-flat-1",
    });
  });

  it("拒绝无效结构化结果并保留 HTTP 状态", async () => {
    await expect(
      inspectContentRisk(config, secrets, { text: "测试" }, {
        fetch: async () => jsonResponse({ output_text: "not-json" }),
      }),
    ).rejects.toThrow(SyntaxError);

    await expect(
      inspectContentRisk(config, secrets, { text: "测试" }, {
        fetch: async () => jsonResponse({ error: "busy" }, 503),
      }),
    ).rejects.toMatchObject({
      name: "ContentRiskProviderError",
      status: 503,
    });
  });

  it("运行检测分别覆盖文字、图片、PDF、Office 和动图", async () => {
    const contentTypes: string[][] = [];
    const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        input: Array<{ content: Array<Record<string, unknown>> }>;
      };
      contentTypes.push(
        body.input[1]?.content.map((item) => String(item.type)) ?? [],
      );
      return jsonResponse({
        output_text: JSON.stringify({
          decision: "ALLOW",
          categories: [],
          reason: "能力检测通过",
        }),
      });
    });

    await expect(
      getContentContactRiskRuntimeHealth(config, secrets, { fetch: request }),
    ).resolves.toMatchObject({
      runtime: "ready",
      textCapability: "READY",
      imageCapability: "READY",
      pdfCapability: "READY",
      officeCapability: "READY",
      animationCapability: "READY",
    });
    expect(contentTypes).toHaveLength(5);
    expect(contentTypes.filter((types) => types.includes("input_image"))).toHaveLength(2);
    expect(contentTypes.filter((types) => types.includes("input_file"))).toHaveLength(2);
  });
});
