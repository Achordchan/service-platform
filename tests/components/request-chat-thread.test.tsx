// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestChatThread } from "@/components/shared/request-chat-thread";
import type { ChatMessage } from "@/components/shared/request-chat-types";

const message: ChatMessage = {
  id: "message-1",
  body: "这条公开回复需要由管理员撤回",
  authorId: "customer-1",
  authorName: "测试客户",
  createdAt: "2026-07-24T07:00:00.000Z",
  visibility: "CUSTOMER_VISIBLE",
  attachments: [],
};

afterEach(cleanup);

function messages(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    ...message,
    id: `message-${index + 1}`,
    body: `消息 ${index + 1}`,
    createdAt: new Date(
      Date.parse("2026-07-24T07:00:00.000Z") + index * 1_000,
    ).toISOString(),
  }));
}

describe("服务请求历史消息加载", () => {
  it("跨自然日时显示淡化日期分隔", () => {
    render(
      <RequestChatThread
        messages={[
          {
            ...message,
            id: "day-one-first",
            body: "第一天第一条",
            createdAt: "2026-07-24T12:00:00.000Z",
          },
          {
            ...message,
            id: "day-one-second",
            body: "第一天第二条",
            createdAt: "2026-07-24T13:00:00.000Z",
          },
          {
            ...message,
            id: "day-two-first",
            body: "第二天第一条",
            createdAt: "2026-07-25T12:00:00.000Z",
          },
        ]}
        currentUserId="admin-1"
      />,
    );

    expect(
      screen.getByRole("separator", { name: "2026年7月24日" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("separator", { name: "2026年7月25日" }),
    ).toBeTruthy();
    expect(screen.getAllByRole("separator")).toHaveLength(2);
  });

  it("不超过 30 条时直接展示，不提前显示历史入口", () => {
    render(
      <RequestChatThread messages={messages(30)} currentUserId="admin-1" />,
    );

    expect(screen.queryByText(/加载更早的消息/)).toBeNull();
    expect(screen.getByText("消息 1")).toBeTruthy();
  });

  it("超过 30 条时才显示剩余历史数量", () => {
    render(
      <RequestChatThread messages={messages(31)} currentUserId="admin-1" />,
    );

    expect(
      screen.getByRole("button", { name: "加载更早的消息（还有 1 条）" }),
    ).toBeTruthy();
    expect(screen.queryByText("消息 1")).toBeNull();
    expect(screen.getByText("消息 2")).toBeTruthy();
  });
});

describe("服务请求消息人工撤回", () => {
  it("平台管理员操作区显示撤回按钮", () => {
    const onRevoke = vi.fn();
    render(
      <RequestChatThread
        messages={[message]}
        currentUserId="admin-1"
        onRevoke={onRevoke}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "撤回 测试客户 的消息" }));
    expect(onRevoke).toHaveBeenCalledWith(message);
  });

  it("普通用户只看到带原因的撤回气泡", () => {
    render(
      <RequestChatThread
        messages={[
          {
            ...message,
            contentRiskStatus: "REVOKED",
            contentRiskReason: "包含站外联系方式引导",
          },
        ]}
        currentUserId="customer-1"
        contentRiskEnabled
      />,
    );

    expect(screen.queryByText(message.body)).toBeNull();
    expect(
      screen.getByText("该内容已被系统撤回：包含站外联系方式引导"),
    ).toBeTruthy();
  });

  it("平台管理员保留原文并看到撤回原因", () => {
    render(
      <RequestChatThread
        messages={[
          {
            ...message,
            contentRiskStatus: "REVOKED",
            contentRiskReason: "包含站外联系方式引导",
          },
        ]}
        currentUserId="admin-1"
        contentRiskEnabled
        canViewRevokedContent
      />,
    );

    expect(screen.getByText(message.body)).toBeTruthy();
    expect(
      screen.getByText(
        "该内容已被系统撤回：包含站外联系方式引导。原文仅平台管理员可见。",
      ),
    ).toBeTruthy();
  });

  it("原发送者可以把撤回内容送回编辑器", () => {
    const onReedit = vi.fn();
    const revokedMessage: ChatMessage = {
      ...message,
      contentRiskStatus: "REVOKED",
      contentRiskReason: "包含站外联系方式引导",
      reeditBody: "<p>这条公开回复需要由管理员撤回</p>",
      reeditAttachmentCount: 2,
    };
    render(
      <RequestChatThread
        messages={[revokedMessage]}
        currentUserId="customer-1"
        contentRiskEnabled
        onReedit={onReedit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "重新编辑" }));
    expect(onReedit).toHaveBeenCalledWith(revokedMessage);
  });
});
