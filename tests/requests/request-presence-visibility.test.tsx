// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRequestPresence } from "@/hooks/use-request-presence";

vi.mock("@/lib/realtime-client", () => ({
  subscribeRealtime: () => () => undefined,
}));

function PresenceProbe() {
  useRequestPresence("request-1", "CUSTOMER");
  return null;
}

let visibilityState: DocumentVisibilityState;
let focused: boolean;

function reportedActions() {
  return vi.mocked(fetch).mock.calls.map(([, init]) => {
    const body = JSON.parse(String(init?.body)) as { action: string };
    return body.action;
  });
}

beforeEach(() => {
  visibilityState = "visible";
  focused = true;
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibilityState,
  });
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { counterpartOnline: false } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("服务请求前台 Presence", () => {
  it("仅在页面可见且窗口有焦点时保持心跳", async () => {
    render(<PresenceProbe />);
    await waitFor(() => {
      expect(reportedActions()).toContain("heartbeat");
    });

    vi.mocked(fetch).mockClear();
    focused = false;
    window.dispatchEvent(new Event("blur"));
    await waitFor(() => {
      expect(reportedActions()).toEqual(["leave"]);
    });

    vi.mocked(fetch).mockClear();
    focused = true;
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => {
      expect(reportedActions()).toEqual(["heartbeat"]);
    });
  });

  it("标签页隐藏时释放 Presence，隐藏期间不会恢复心跳", async () => {
    render(<PresenceProbe />);
    await waitFor(() => {
      expect(reportedActions()).toContain("heartbeat");
    });

    vi.mocked(fetch).mockClear();
    visibilityState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => {
      expect(reportedActions()).toEqual(["leave"]);
    });

    vi.mocked(fetch).mockClear();
    window.dispatchEvent(new Event("focus"));
    await Promise.resolve();
    expect(reportedActions()).toEqual([]);
  });
});
