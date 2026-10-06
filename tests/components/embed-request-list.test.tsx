// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EmbedRequestListView,
  countByFilter,
  formatRelativeTime,
  type EmbedListFilter,
  type EmbedRequestListItem,
  type EmbedRequestStatus,
} from "@/components/embed/embed-request-list";

afterEach(() => cleanup());

function makeRequest(
  id: string,
  status: EmbedRequestStatus,
  overrides: Partial<EmbedRequestListItem> = {},
): EmbedRequestListItem {
  return {
    id,
    number: `SR-20261006-${id}`,
    title: `请求 ${id}`,
    description: `描述 ${id}`,
    priority: "NORMAL",
    status,
    updatedAt: new Date().toISOString(),
    category: { id: "c1", name: "服务失联" },
    unreadCount: 0,
    ...overrides,
  };
}

function Harness({
  requests,
  writable = true,
  onOpen = () => undefined,
  onCreate = () => undefined,
}: {
  requests: EmbedRequestListItem[];
  writable?: boolean;
  onOpen?: (id: string) => void;
  onCreate?: () => void;
}) {
  const [filter, setFilter] = useState<EmbedListFilter>("all");
  return (
    <EmbedRequestListView
      requests={requests}
      writable={writable}
      filter={filter}
      onFilterChange={setFilter}
      onOpen={onOpen}
      onCreate={onCreate}
    />
  );
}

const FIVE = [
  makeRequest("a", "WAITING_CUSTOMER", { unreadCount: 2, priority: "HIGH" }),
  makeRequest("b", "IN_PROGRESS"),
  makeRequest("c", "PENDING"),
  makeRequest("d", "RESOLVED"),
  makeRequest("e", "CLOSED"),
];

describe("formatRelativeTime", () => {
  const now = new Date("2026-10-06T12:00:00+08:00").getTime();
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  it("按量级换算成相对时间", () => {
    expect(formatRelativeTime(ago(10_000), now)).toBe("刚刚");
    expect(formatRelativeTime(ago(5 * minute), now)).toBe("5 分钟前");
    expect(formatRelativeTime(ago(2 * hour), now)).toBe("2 小时前");
    expect(formatRelativeTime(ago(30 * hour), now)).toBe("昨天");
    expect(formatRelativeTime(ago(3 * day), now)).toBe("3 天前");
  });

  it("超过一周显示日期，跨年带年份", () => {
    expect(formatRelativeTime("2026-09-12T08:00:00+08:00", now)).toBe("9 月 12 日");
    expect(formatRelativeTime("2025-12-31T08:00:00+08:00", now)).toBe("2025 年 12 月 31 日");
  });

  it("时钟略快于服务端时不出现负数", () => {
    expect(formatRelativeTime(new Date(now + 5 * minute).toISOString(), now)).toBe("刚刚");
  });

  it("无法解析的时间返回空串", () => {
    expect(formatRelativeTime("not-a-date", now)).toBe("");
  });
});

describe("countByFilter", () => {
  it("等待客户单独成组，处理中与待处理并入进行中", () => {
    expect(countByFilter(FIVE)).toEqual({ all: 5, wait: 1, doing: 2, done: 2 });
  });
});

describe("EmbedRequestListView", () => {
  it("卡片展示未读角标、高优先级和状态", () => {
    render(<Harness requests={FIVE} />);
    const card = screen.getByRole("button", { name: /请求 a/ });
    expect(card.textContent).toContain("2 条新消息");
    expect(card.textContent).toContain("高优先级");
    expect(card.textContent).toContain("等待客户");
    expect(card.textContent).toContain("描述 a");
  });

  it("只有等待客户与已解决的卡片带底部提示", () => {
    render(<Harness requests={FIVE} />);
    expect(screen.getByRole("button", { name: /请求 a/ }).textContent).toContain("客服在等你的回复");
    expect(screen.getByRole("button", { name: /请求 d/ }).textContent).toContain("问题已解决");
    expect(screen.getByRole("button", { name: /请求 b/ }).textContent).not.toContain("去");
  });

  it("只读项目不显示任何行动提示带", () => {
    render(<Harness requests={FIVE} writable={false} />);
    const waiting = screen.getByRole("button", { name: /请求 a/ });
    const resolved = screen.getByRole("button", { name: /请求 d/ });
    expect(waiting.textContent).not.toContain("去回复");
    expect(waiting.textContent).not.toContain("客服在等你的回复");
    expect(resolved.textContent).not.toContain("去确认");
    // 状态 Chip 仍在，只是不再引导动作
    expect(waiting.textContent).toContain("等待客户");
  });

  it("底部提示不含「关闭」，不干扰名为「关闭」的宿主按钮查询", () => {
    render(<Harness requests={FIVE.slice(0, 4)} />);
    // 已关闭状态本身会让名字含「关闭」，这里只验证提示文案没有额外引入
    expect(screen.getByRole("button", { name: /请求 d/ }).textContent).not.toContain("关闭");
  });

  it("筛选条按分组过滤，并显示数量", () => {
    render(<Harness requests={FIVE} />);
    const group = screen.getByRole("group", { name: "按状态筛选" });
    expect(group.textContent).toContain("全部5");
    expect(group.textContent).toContain("待我回复1");

    fireEvent.click(screen.getByRole("button", { name: /^进行中/ }));
    expect(screen.getByRole("button", { name: /^进行中/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: /请求 a/ })).toBeNull();
    expect(screen.getByRole("button", { name: /请求 b/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /请求 c/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^已完成/ }));
    expect(screen.queryByRole("button", { name: /请求 b/ })).toBeNull();
    expect(screen.getByRole("button", { name: /请求 e/ })).toBeTruthy();
  });

  it("卡片与筛选按钮在键盘聚焦时有可见轮廓", () => {
    render(<Harness requests={FIVE} />);
    const targets = [
      screen.getByRole("button", { name: /请求 b/ }),
      screen.getByRole("button", { name: /^进行中/ }),
    ];
    for (const element of targets) {
      expect(getComputedStyle(element).outline).not.toContain("solid");
      // MUI 在键盘聚焦时会加上这个类名
      element.classList.add("Mui-focusVisible");
      expect(getComputedStyle(element).outline).toContain("2px solid");
    }
  });

  it("请求太少时不显示筛选条", () => {
    render(<Harness requests={FIVE.slice(0, 3)} />);
    expect(screen.queryByRole("group", { name: "按状态筛选" })).toBeNull();
  });

  it("点击卡片回调请求 id", () => {
    const onOpen = vi.fn();
    render(<Harness requests={FIVE} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /请求 b/ }));
    expect(onOpen).toHaveBeenCalledWith("b");
  });

  it("没有请求时展示空状态和新建入口", () => {
    const onCreate = vi.fn();
    render(<Harness requests={[]} onCreate={onCreate} />);
    expect(screen.getByRole("heading", { name: "暂无服务请求" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "新建服务请求" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("只读项目的空状态不给新建入口", () => {
    render(<Harness requests={[]} writable={false} />);
    expect(screen.queryByRole("button", { name: "新建服务请求" })).toBeNull();
    expect(screen.getByText("当前项目只允许查看历史服务请求。")).toBeTruthy();
  });
});
