// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAttachmentPolicy } from "@/hooks/use-attachment-policy";

function PolicyConsumer({ label }: { label: string }) {
  const { policy, loading } = useAttachmentPolicy();
  return <div>{`${label}:${loading ? "loading" : policy.maxSizeMb}`}</div>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("附件策略查询", () => {
  it("多个消费者共享同一次请求", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            maxSizeMb: 30,
            allowedExtensions: ["png", "pdf"],
            customerReplyAttachmentsEnabled: true,
            accept: ".png,.pdf",
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
        <PolicyConsumer label="first" />
        <PolicyConsumer label="second" />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("first:30")).toBeTruthy();
      expect(screen.getByText("second:30")).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
