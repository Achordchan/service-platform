// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupportReplyAssistant } from "@/components/staff/support-reply-assistant";
import { queryKeys } from "@/lib/query-keys";

const staffApiMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/staff/staff-api", () => ({
  staffApi: staffApiMock,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("回复助手查询", () => {
  it("重复打开抽屉复用处理指南缓存", async () => {
    staffApiMock.mockResolvedValue([
      {
        key: "diagnostic-guide",
        category: "DIAGNOSTIC",
        title: "网络诊断指南",
        summary: "检查网络连接",
        introduction: "请执行以下操作",
        steps: ["检查网络"],
        safetyNotes: [],
      },
    ]);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <SupportReplyAssistant onSend={vi.fn()} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "回复助手" }));
    await screen.findByText("网络诊断指南");
    fireEvent.click(screen.getByRole("button", { name: "关闭回复助手" }));
    fireEvent.click(await screen.findByRole("button", { name: "回复助手" }));
    await screen.findByText("网络诊断指南");

    expect(staffApiMock).toHaveBeenCalledTimes(1);
  });

  it("不会复用后台管理端包含停用或已删除指南的缓存", async () => {
    staffApiMock.mockResolvedValue([
      {
        key: "available-guide",
        category: "INFORMATION",
        title: "可发送指南",
        summary: "当前可用",
        introduction: "请查看",
        steps: ["继续处理"],
        safetyNotes: [],
      },
    ]);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    queryClient.setQueryData(queryKeys.supportPlaybooks.admin, [
      { key: "deleted-guide", title: "已删除指南", deletedAt: "2026-08-01" },
    ]);

    render(
      <QueryClientProvider client={queryClient}>
        <SupportReplyAssistant onSend={vi.fn()} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "回复助手" }));

    expect(await screen.findByText("可发送指南")).toBeTruthy();
    expect(screen.queryByText("已删除指南")).toBeNull();
    expect(staffApiMock).toHaveBeenCalledOnce();
  });

  it("发送失败后仍保留指南列表并允许直接重试", async () => {
    staffApiMock.mockResolvedValue([
      {
        key: "retry-guide",
        category: "DIAGNOSTIC",
        title: "可重试指南",
        summary: "发送失败后继续重试",
        introduction: "请执行以下操作",
        steps: ["再次发送"],
        safetyNotes: [],
      },
    ]);
    const onSend = vi
      .fn()
      .mockRejectedValueOnce(new Error("发送失败"))
      .mockResolvedValueOnce(undefined);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <SupportReplyAssistant onSend={onSend} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "回复助手" }));
    fireEvent.click(await screen.findByText("可重试指南"));
    fireEvent.click(screen.getByRole("button", { name: "发送给客户" }));

    expect(await screen.findByText("发送失败")).toBeTruthy();
    expect(screen.getByRole("button", { name: "发送给客户" })).toBeTruthy();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "发送给客户" }).hasAttribute("disabled"),
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "发送给客户" }));
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2));
  });
});
