// SSE 协议纯解析（无平台依赖，独立成模块便于单测与复用）：
// 小程序没有 EventSource；onChunkReceived 给出 ArrayBuffer，需要自行按
// \n\n 分帧并处理跨 chunk 的 UTF-8 多字节截断（缓冲字节而不是字符串）。
export type StreamEvent = {
  id: string | null;
  event: string;
  data: Record<string, unknown>;
};

/** UTF-8 字节 → 字符串（小程序无 TextDecoder 时可用；支持至四字节序列） */
export function decodeUtf8(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const first = bytes[i]!;
    if (first < 0x80) {
      out += String.fromCharCode(first);
      i += 1;
    } else if (first < 0xe0) {
      out += String.fromCharCode(
        ((first & 0x1f) << 6) | (bytes[i + 1]! & 0x3f),
      );
      i += 2;
    } else if (first < 0xf0) {
      out += String.fromCharCode(
        ((first & 0x0f) << 12) | ((bytes[i + 1]! & 0x3f) << 6) | (bytes[i + 2]! & 0x3f),
      );
      i += 3;
    } else {
      const code =
        ((first & 0x07) << 18) |
        ((bytes[i + 1]! & 0x3f) << 12) |
        ((bytes[i + 2]! & 0x3f) << 6) |
        (bytes[i + 3]! & 0x3f);
      out += String.fromCodePoint(code);
      i += 4;
    }
  }
  return out;
}

/** 解析一段完整的 SSE 帧文本（不含结尾空行） */
export function parseSseFrame(frame: string): StreamEvent | null {
  let id: string | null = null;
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "id") id = value;
    else if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
  }
  if (dataLines.length === 0) return null;
  try {
    return { id, event, data: JSON.parse(dataLines.join("\n")) as Record<string, unknown> };
  } catch {
    return null;
  }
}

/** 增量分帧器：喂入字节块，产出完整帧文本 */
export class SseChunker {
  private buffer = new Uint8Array(0);

  push(chunk: Uint8Array): string[] {
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer, 0);
    merged.set(chunk, this.buffer.length);
    const frames: string[] = [];
    let start = 0;
    for (let i = 0; i + 1 < merged.length; i += 1) {
      if (merged[i] === 10 && merged[i + 1] === 10) {
        // \n\n 帧边界；兼容 \r\n\r\n
        let end = i;
        if (end > start && merged[end - 1] === 13) end -= 1;
        frames.push(decodeUtf8(merged.subarray(start, end)));
        start = i + 2;
        i += 1;
      }
    }
    this.buffer = merged.subarray(start);
    return frames;
  }
}

