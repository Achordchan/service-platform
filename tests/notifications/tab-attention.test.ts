// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetTabAttentionForTests,
  startTabAttention,
  stopTabAttention,
} from "@/lib/tab-attention";

afterEach(() => {
  resetTabAttentionForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("隐藏标签页提醒", () => {
  it("失去焦点时闪烁标题，返回后恢复", () => {
    vi.useFakeTimers();
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    document.title = "服务支持中心";

    startTabAttention();
    expect(document.title).toBe("【新消息】 服务支持中心");
    vi.advanceTimersByTime(800);
    expect(document.title).toBe("服务支持中心");
    vi.advanceTimersByTime(800);
    expect(document.title).toBe("【新消息】 服务支持中心");

    stopTabAttention();
    expect(document.title).toBe("服务支持中心");
  });
});
