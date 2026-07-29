// @vitest-environment jsdom

import { StrictMode } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const realtimeMocks = vi.hoisted(() => ({
  eventHandler: null as ((event: {
    live: boolean;
    payload: { requestId?: string; serviceRequestId?: string };
  }) => void) | null,
  subscribeRealtime: vi.fn(),
  subscribeRealtimeReady: vi.fn(() => vi.fn()),
}));

realtimeMocks.subscribeRealtime.mockImplementation(
  (_types, handler: typeof realtimeMocks.eventHandler) => {
    realtimeMocks.eventHandler = handler;
    return vi.fn();
  },
);

vi.mock("@/lib/realtime-client", () => ({
  subscribeRealtime: realtimeMocks.subscribeRealtime,
  subscribeRealtimeReady: realtimeMocks.subscribeRealtimeReady,
}));

import { useRequestNotificationsRead } from "@/hooks/use-request-notifications-read";

function Probe({ requestId }: { requestId: string }) {
  useRequestNotificationsRead(requestId);
  return null;
}

beforeEach(() => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  realtimeMocks.eventHandler = null;
});

describe("request notification read sync", () => {
  it("survives the StrictMode mount-cleanup-remount cycle", async () => {
    const pendingResponses: Array<(response: Response) => void> = [];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            pendingResponses.push(resolve);
          }),
      );
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    render(
      <StrictMode>
        <Probe requestId="request-1" />
      </StrictMode>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    for (const resolve of pendingResponses) {
      resolve(new Response(null, { status: 200 }));
    }

    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "notifications-updated",
          detail: { serviceRequestId: "request-1" },
        }),
      );
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/v1/notifications",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ serviceRequestId: "request-1" }),
      }),
    );
  });

  it("runs a trailing read after a live event inside the debounce window", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    render(<Probe requestId="request-1" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    realtimeMocks.eventHandler?.({
      live: true,
      payload: { requestId: "request-1" },
    });

    await waitFor(
      () => expect(fetchMock).toHaveBeenCalledTimes(2),
      { timeout: 1_000 },
    );
  });

  it("keeps notifications unread while the request tab is in the background", async () => {
    let visibilityState: DocumentVisibilityState = "hidden";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilityState,
    });
    vi.mocked(document.hasFocus).mockReturnValue(false);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    render(<Probe requestId="request-1" />);
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(fetchMock).not.toHaveBeenCalled();

    realtimeMocks.eventHandler?.({
      live: true,
      payload: { requestId: "request-1" },
    });
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    expect(fetchMock).not.toHaveBeenCalled();

    visibilityState = "visible";
    vi.mocked(document.hasFocus).mockReturnValue(true);
    fireEvent(document, new Event("visibilitychange"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});
