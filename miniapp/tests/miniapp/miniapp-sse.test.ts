import { describe, expect, it } from "vitest";
import {
  SseChunker,
  decodeUtf8,
  parseSseFrame,
} from "../../miniapp/src/lib/sse";

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("小程序 SSE 解析", () => {
  it("decodeUtf8 正确处理中文与 emoji（跨字节序列）", () => {
    const text = "工单回复：网站无法访问 ✅ 已处理";
    expect(decodeUtf8(bytes(text))).toBe(text);
  });

  it("parseSseFrame 解析 id/event/data 并合并多行 data", () => {
    const frame = parseSseFrame('id: 42\nevent: REQUEST_MESSAGE_CREATED\ndata: {"a":1,\n"data: {"b":2}');
    expect(frame?.id).toBe("42");
    expect(frame?.event).toBe("REQUEST_MESSAGE_CREATED");
    expect(frame?.data).toEqual({ a: 1, b: 2 });
  });

  it("心跳注释帧返回 null", () => {
    expect(parseSseFrame(": heartbeat")).toBeNull();
  });

  it("分帧器处理跨 chunk 的 UTF-8 截断与 \\r\\n 行尾", () => {
    const chunker = new SseChunker();
    const full =
      'id: 1\nevent: A\r\ndata: {"title":"中文标题"}\n\n: heartbeat\n\nid: 2\nevent: B\ndata: {"x":9}\n\n';
    // 按任意位置切开喂入，模拟网络分块（含多字节字符中间截断）
    const mid = Math.floor(full.length / 2);
    const head = full.slice(0, mid);
    const tail = full.slice(mid);
    const frames = [
      ...chunker.push(bytes(head)),
      ...chunker.push(bytes(tail)),
    ].map(parseSseFrame);
    const valid = frames.filter((f): f is NonNullable<typeof f> => f !== null);
    expect(valid).toHaveLength(2);
    expect(valid[0]!.data).toEqual({ title: "中文标题" });
    expect(valid[1]!.id).toBe("2");
    expect(valid[1]!.data).toEqual({ x: 9 });
  });
});
