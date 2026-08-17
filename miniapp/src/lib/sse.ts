// 小程序 SSE 连接（wx.request enableChunked）+ 协议解析（sse-parser）
import { API_BASE_URL } from "../config";
import { getToken } from "./auth";
import { parseSseFrame, SseChunker, type StreamEvent } from "./sse-parser";

export { decodeUtf8, parseSseFrame, SseChunker } from "./sse-parser";
export type { StreamEvent } from "./sse-parser";

export type SseConnection = {
  close: () => void;
};

export type SseOptions = {
  path: string;
  lastEventId?: string;
  onEvent: (event: StreamEvent) => void;
  onReady: () => void;
  onStateChange: (state: "connecting" | "open" | "closed") => void;
};

/**
 * 建立一条 SSE 连接（不自动重连；重连策略由调用方控制）。
 * 返回句柄用于关闭。请求失败/中断通过 onStateChange("closed") 通知。
 */
export function connectSse(options: SseOptions): SseConnection {
  const header: Record<string, string> = {
    Accept: "text/event-stream",
  };
  const token = getToken();
  if (token) header.Authorization = `Bearer ${token}`;
  if (options.lastEventId) header["Last-Event-ID"] = options.lastEventId;

  const chunker = new SseChunker();
  let task: WechatMiniprogram.RequestTask | null = null;
  let closedByUser = false;

  options.onStateChange("connecting");
  task = wx.request({
    url: `${API_BASE_URL}${options.path}`,
    method: "GET",
    header,
    enableChunked: true,
    timeout: 300_000,
    success: () => {
      // chunked 模式下 success 表示流已结束
      options.onStateChange("closed");
    },
    fail: () => {
      if (!closedByUser) options.onStateChange("closed");
    },
  });

  task.onChunkReceived((res: { data: ArrayBuffer }) => {
    if (closedByUser) return;
    options.onStateChange("open");
    const frames = chunker.push(new Uint8Array(res.data));
    for (const frame of frames) {
      const parsed = parseSseFrame(frame);
      if (!parsed) continue;
      if (parsed.event === "STREAM_READY") {
        options.onReady();
        continue;
      }
      options.onEvent(parsed);
    }
  });

  return {
    close() {
      closedByUser = true;
      try {
        task?.abort();
      } catch {
        // 已结束的连接 abort 会抛错，忽略
      }
      options.onStateChange("closed");
    },
  };
}
