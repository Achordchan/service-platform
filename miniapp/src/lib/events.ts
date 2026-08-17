// EventRecord 实时同步管理器（纯 SSE，无轮询）：
// - 唯一事件通道：/api/miniapp/events/stream（与 Web SSE 同一实现）
// - 断开按指数退避自动重连（1s 起、30s 封顶），网络恢复立即重连
// - 游标持久化 storage + Last-Event-ID 断线续传（服务端 EventRecord 回放，不丢事件）
// - 活跃页面计数控制生命周期：onShow start / onHide stop，归零才真正断流
// 【约束】禁止引入轮询兜底：连接建立与断线恢复均由流自身完成（服务端先回放再 READY）。
import { connectSse, type SseConnection, type StreamEvent } from "./sse";

type MiniappEvent = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  projectId: string | null;
  serviceRequestId: string | null;
  customerSpaceId: string | null;
  createdAt: string;
};

type EventListener = (events: MiniappEvent[]) => void;

const CURSOR_KEY = "miniapp_event_cursor";
const SSE_RECONNECT_BASE_MS = 1_000;
const SSE_RECONNECT_MAX_MS = 30_000;

class EventSyncManager {
  private listeners = new Set<EventListener>();
  // 引用计数：多个页面同时活跃时（如消息 tab push 工单详情），
  // 后退页的 stop() 不得清掉前进页 start() 建立的连接
  private activePages = 0;
  private sse: SseConnection | null = null;
  private sseRetries = 0;
  private sseReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastEventId: string | null = null;

  getCursor(): bigint {
    const raw = wx.getStorageSync(CURSOR_KEY) as string;
    if (!raw) return 0n;
    try {
      return BigInt(raw);
    } catch {
      return 0n;
    }
  }

  reset() {
    wx.removeStorageSync(CURSOR_KEY);
    this.lastEventId = null;
    this.stopSse();
  }

  on(listener: EventListener) {
    this.listeners.add(listener);
  }

  off(listener: EventListener) {
    this.listeners.delete(listener);
  }

  private emit(events: MiniappEvent[]) {
    if (events.length === 0) return;
    for (const listener of this.listeners) {
      try {
        listener(events);
      } catch (error) {
        // 页面回调异常不影响同步循环，但必须留日志（曾因静默吞掉 this 错误导致功能失效）
        console.error("[eventSync] listener error:", error);
      }
    }
  }

  /** 流事件 → 统一事件形态并推进游标 */
  private handleStreamEvent(event: StreamEvent) {
    const id = typeof event.data.eventId === "string" ? event.data.eventId : null;
    if (id) {
      this.lastEventId = id;
      wx.setStorageSync(CURSOR_KEY, id);
    }
    const serviceRequestId =
      typeof event.data.serviceRequestId === "string"
        ? (event.data.serviceRequestId as string)
        : typeof event.data.requestId === "string"
          ? (event.data.requestId as string)
          : null;
    this.emit([
      {
        id: id ?? "",
        type: event.event,
        payload: event.data,
        projectId: typeof event.data.projectId === "string" ? event.data.projectId : null,
        serviceRequestId,
        customerSpaceId:
          typeof event.data.customerSpaceId === "string"
            ? event.data.customerSpaceId
            : null,
        createdAt: new Date().toISOString(),
      },
    ]);
  }

  private startSse() {
    this.stopSseReconnectTimer();
    this.sse = connectSse({
      path: "/api/miniapp/events/stream",
      lastEventId: this.lastEventId ?? this.getCursor().toString(),
      onEvent: (event) => this.handleStreamEvent(event),
      onReady: () => {
        // 连接就绪：服务端在 READY 前已按 Last-Event-ID 回放积压事件
        this.sseRetries = 0;
      },
      onStateChange: (state) => {
        if (state === "closed" && this.activePages > 0) {
          this.sse = null;
          this.scheduleSseReconnect();
        }
      },
    });
  }

  private stopSse() {
    this.stopSseReconnectTimer();
    this.sse?.close();
    this.sse = null;
  }

  private scheduleSseReconnect() {
    if (this.sseReconnectTimer) return;
    const delay = Math.min(
      SSE_RECONNECT_BASE_MS * 2 ** this.sseRetries,
      SSE_RECONNECT_MAX_MS,
    );
    this.sseRetries += 1;
    this.sseReconnectTimer = setTimeout(() => {
      this.sseReconnectTimer = null;
      if (this.activePages > 0) this.startSse();
    }, delay);
  }

  private stopSseReconnectTimer() {
    if (this.sseReconnectTimer) {
      clearTimeout(this.sseReconnectTimer);
      this.sseReconnectTimer = null;
    }
  }

  /** 页面激活（onShow）时调用：计数 +1；首层激活建立实时流 */
  start() {
    this.activePages += 1;
    if (this.activePages === 1) {
      this.startSse();
    }
  }

  /** 页面隐藏（onHide）时调用：计数 -1，归零才真正断流 */
  stop() {
    this.activePages = Math.max(0, this.activePages - 1);
    if (this.activePages === 0) {
      this.stopSse();
    }
  }

  /** 网络恢复 / 回前台等场景调用：清退避立即重连（活跃时） */
  wake() {
    this.sseRetries = 0;
    if (this.activePages > 0 && !this.sse) {
      this.startSse();
    }
  }
}

export const eventSync = new EventSyncManager();
export type { MiniappEvent, EventListener };
