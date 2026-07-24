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
