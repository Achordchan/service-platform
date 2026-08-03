// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";

vi.mock("@/lib/realtime-client", () => ({
  subscribeRealtime: () => () => undefined,
  subscribeRealtimeReady: () => () => undefined,
}));

function UnreadConsumer({ label }: { label: string }) {
  const { unread } = useUnreadNotifications();
  return <div>{`${label}:${unread.totalUnread}`}</div>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("未读通知摘要", () => {
  it("多个导航消费者共享同一次摘要请求", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            totalUnread: 4,
            navigation: { projects: true, requests: true },
            projectDeliveryCounts: {},
            projectUpdateCounts: {},
            projectStageCounts: {},
            projectMilestoneCounts: {},
            projectFileCounts: {},
            projectRequestCounts: {},
            requestUnreadCounts: {},
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <UnreadConsumer label="first" />
        <UnreadConsumer label="second" />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("first:4")).toBeTruthy();
      expect(screen.getByText("second:4")).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
