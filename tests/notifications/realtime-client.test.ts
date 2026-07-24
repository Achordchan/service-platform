// @vitest-environment jsdom

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isProjectDeletedRealtimeEvent,
  matchesRealtimeScope,
  resetRealtimeClientForTests,
  subscribeRealtime,
  subscribeRealtimeReady,
  type RealtimeEvent,
} from "@/lib/realtime-client";

class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  closed = false;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, payload: Record<string, unknown>, lastEventId = "1") {
    this.dispatchEvent(
      new MessageEvent(type, {
        data: JSON.stringify(payload),
        lastEventId,
      }),
    );
  }
}

const originalEventSource = globalThis.EventSource;

beforeEach(() => {
  resetRealtimeClientForTests();
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterAll(() => {
  resetRealtimeClientForTests();
  vi.unstubAllGlobals();
  if (originalEventSource) {
    globalThis.EventSource = originalEventSource;
  }
});

describe("SSE 浏览器连接复用", () => {
  it("只把当前项目的删除事件识别为详情页退出信号", () => {
    const event: RealtimeEvent = {
      type: "PROJECT_UPDATED",
      payload: { projectId: "project-1", change: "PROJECT_DELETED" },
      live: true,
      replayed: false,
      lastEventId: "1",
    };

    expect(isProjectDeletedRealtimeEvent(event, "project-1")).toBe(true);
    expect(isProjectDeletedRealtimeEvent(event, "project-2")).toBe(false);
    expect(
      isProjectDeletedRealtimeEvent(
        { ...event, payload: { ...event.payload, change: "PROJECT_UPDATED" } },
        "project-1",
      ),
    ).toBe(false);
  });

  it("多个订阅者共用一条连接，并区分补取事件和实时事件", () => {
    const received: RealtimeEvent[] = [];
    const readyStates: boolean[] = [];
    const unsubscribeProject = subscribeRealtime(
      ["PROJECT_UPDATE_CREATED"],
      (event) => received.push(event),
    );
    const unsubscribeRequest = subscribeRealtime(
      ["REQUEST_STATUS_CHANGED"],
      (event) => received.push(event),
    );
    const unsubscribeReady = subscribeRealtimeReady(({ reconnected }) => {
      readyStates.push(reconnected);
    });

    expect(FakeEventSource.instances).toHaveLength(1);
    const source = FakeEventSource.instances[0]!;
    source.emit("PROJECT_UPDATE_CREATED", { projectId: "project-1" }, "10");
    expect(received[0]).toMatchObject({
      type: "PROJECT_UPDATE_CREATED",
      live: false,
      replayed: false,
      lastEventId: "10",
    });

    source.emit("STREAM_READY", { eventId: "10" }, "10");
    source.emit(
      "REQUEST_STATUS_CHANGED",
      { requestId: "request-1" },
      "11",
    );
    expect(readyStates).toEqual([false]);
    expect(received[1]).toMatchObject({
      type: "REQUEST_STATUS_CHANGED",
      live: true,
      replayed: false,
      lastEventId: "11",
    });

    unsubscribeProject();
    unsubscribeRequest();
    expect(source.closed).toBe(false);
    unsubscribeReady();
    expect(source.closed).toBe(true);
  });

  it("后挂载订阅者可补到当前连接已收到的事件", async () => {
    const unsubscribeFirst = subscribeRealtime(
      ["PROJECT_UPDATED"],
      () => undefined,
    );
    const source = FakeEventSource.instances[0]!;
    source.emit("PROJECT_UPDATED", { projectId: "project-1" }, "21");
    source.emit("STREAM_READY", { eventId: "21" }, "21");

    const received: RealtimeEvent[] = [];
    const ready = vi.fn();
    const unsubscribeLate = subscribeRealtime(
      ["PROJECT_UPDATED"],
      (event) => received.push(event),
    );
    const unsubscribeReady = subscribeRealtimeReady(ready);
    await Promise.resolve();

    expect(received).toEqual([
      expect.objectContaining({
        type: "PROJECT_UPDATED",
        live: false,
        replayed: true,
      }),
    ]);
    expect(ready).toHaveBeenCalledWith({ reconnected: false });

    unsubscribeLate();
    unsubscribeReady();
    unsubscribeFirst();
  });

  it("同一连接可以接收不落库的输入状态事件", () => {
    const received: RealtimeEvent[] = [];
    const unsubscribe = subscribeRealtime(
      ["REQUEST_TYPING_CHANGED"],
      (event) => received.push(event),
    );
    const source = FakeEventSource.instances[0]!;
    source.emit("STREAM_READY", { eventId: "30" }, "30");
    source.emit(
      "REQUEST_TYPING_CHANGED",
      {
        requestId: "request-1",
        group: "CUSTOMER",
        typing: true,
      },
      "30",
    );

    expect(received).toEqual([
      expect.objectContaining({
        type: "REQUEST_TYPING_CHANGED",
        live: true,
        payload: expect.objectContaining({
          requestId: "request-1",
          typing: true,
        }),
      }),
    ]);
    unsubscribe();
  });

  it("可以接收内容风控审核状态事件", () => {
    const received: RealtimeEvent[] = [];
    const unsubscribe = subscribeRealtime(
      ["CONTENT_RISK_REVIEW_UPDATED"],
      (event) => received.push(event),
    );
    const source = FakeEventSource.instances[0]!;
    source.emit("STREAM_READY", { eventId: "40" }, "40");
    source.emit(
      "CONTENT_RISK_REVIEW_UPDATED",
      {
        projectId: "project-1",
        serviceRequestId: "request-1",
        targetType: "REQUEST_MESSAGE",
        targetId: "message-1",
        status: "VIOLATION",
      },
      "41",
    );

    expect(received).toEqual([
      expect.objectContaining({
        type: "CONTENT_RISK_REVIEW_UPDATED",
        live: true,
        payload: expect.objectContaining({
          serviceRequestId: "request-1",
          status: "VIOLATION",
        }),
      }),
    ]);
    unsubscribe();
  });
});

describe("SSE 事件范围匹配", () => {
  it("项目页面只响应同一项目事件", () => {
    expect(
      matchesRealtimeScope(
        { projectId: "project-1" },
        { projectId: "project-1" },
      ),
    ).toBe(true);
    expect(
      matchesRealtimeScope(
        { projectId: "project-2" },
        { projectId: "project-1" },
      ),
    ).toBe(false);
  });

  it("请求页面兼容 requestId 和 serviceRequestId", () => {
    expect(
      matchesRealtimeScope(
        { requestId: "request-1" },
        { requestId: "request-1" },
      ),
    ).toBe(true);
    expect(
      matchesRealtimeScope(
        { serviceRequestId: "request-1" },
        { requestId: "request-1" },
      ),
    ).toBe(true);
  });
});
