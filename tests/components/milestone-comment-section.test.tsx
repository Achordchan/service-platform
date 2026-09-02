// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { MilestoneList } from "@/components/shared/milestone-list";
import type { MilestoneListItem } from "@/components/shared/milestone-list";
import { appTheme } from "@/theme/theme";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

// CollapsibleText 用 ResizeObserver 判断溢出，jsdom 没有
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

afterEach(cleanup);

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider theme={appTheme}>{ui}</ThemeProvider>);
}

const milestone: MilestoneListItem = {
  id: "milestone-1",
  title: "需求确认",
  description: "<p>第一阶段目标说明</p>",
  status: "IN_PROGRESS",
  startDate: "2026-09-01",
  endDate: "2026-09-30",
  createdAt: new Date("2026-09-01T10:00:00Z").toISOString(),
  comments: [
    {
      id: "comment-1",
      body: "<p>客户留言</p>",
      authorId: "customer-1",
      authorName: "客户甲",
      createdAt: new Date("2026-09-01T11:00:00Z").toISOString(),
    },
    {
      id: "comment-2",
      body: "<p>员工回复</p>",
      authorId: "staff-1",
      authorName: "员工乙",
      createdAt: new Date("2026-09-01T12:00:00Z").toISOString(),
    },
  ],
};

describe("里程碑详情弹窗的常驻评论区", () => {
  it("打开详情后评论直接可见，不需要再点「评论」", () => {
    renderWithTheme(
      <MilestoneList milestones={[milestone]} currentUserId="customer-1" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "查看详情" }));
    expect(screen.getByText("客户留言")).toBeTruthy();
    expect(screen.getByText("员工回复")).toBeTruthy();
    expect(screen.getByText("客户甲")).toBeTruthy();
  });

  it("列表行只显示评论数提示，不出现单独的评论按钮", () => {
    renderWithTheme(<MilestoneList milestones={[milestone]} />);
    expect(screen.queryByRole("button", { name: /评论/ })).toBeNull();
    expect(screen.getByText("2 条评论")).toBeTruthy();
  });

  it("只对自己的评论亮出编辑按钮", () => {
    renderWithTheme(
      <MilestoneList
        milestones={[milestone]}
        currentUserId="customer-1"
        onEditComment={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "查看详情" }));
    // 客户甲（自己）有编辑按钮，员工乙没有；Tooltip 会把 aria-label 复制到
    // 外层 span，所以要按 role 查、不能用 getAllByLabelText
    expect(screen.getAllByRole("button", { name: "编辑评论" })).toHaveLength(1);
  });

  it("没有传 onEditComment 时不显示编辑按钮", () => {
    renderWithTheme(
      <MilestoneList milestones={[milestone]} currentUserId="customer-1" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "查看详情" }));
    expect(screen.queryByRole("button", { name: "编辑评论" })).toBeNull();
  });

  it("无正文但有评论或可评论时仍提供详情入口", () => {
    const noDescription = { ...milestone, description: null };
    const { rerender } = renderWithTheme(
      <MilestoneList milestones={[noDescription]} />,
    );
    expect(screen.getByRole("button", { name: "查看详情" })).toBeTruthy();

    rerender(
      <ThemeProvider theme={appTheme}>
        <MilestoneList
          milestones={[{ ...noDescription, comments: [] }]}
          canComment
          onComposerChange={vi.fn()}
        />
      </ThemeProvider>,
    );
    expect(screen.getByRole("button", { name: "查看详情" })).toBeTruthy();
  });

  it("切换或关闭详情时通知父组件清空共享草稿", () => {
    const onDetailChange = vi.fn();
    renderWithTheme(
      <MilestoneList
        milestones={[milestone]}
        onDetailChange={onDetailChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "查看详情" }));
    expect(onDetailChange).toHaveBeenCalledWith("milestone-1");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onDetailChange).toHaveBeenLastCalledWith(null);
  });

  it("删除权限与作者编辑权限分开：员工可删客户评论但不能编辑", () => {
    renderWithTheme(
      <MilestoneList
        milestones={[milestone]}
        currentUserId="staff-1"
        onEditComment={vi.fn()}
        onDeleteComment={vi.fn()}
        canDeleteComment={() => true}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "查看详情" }));
    expect(screen.getAllByRole("button", { name: "编辑评论" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "删除评论" })).toHaveLength(2);
  });

  it("canComment 时显示评论输入框，发送按钮带着当前里程碑回调", () => {
    const onSubmit = vi.fn();
    renderWithTheme(
      <MilestoneList
        milestones={[milestone]}
        canComment
        composerValue="我有一条问题"
        onComposerChange={vi.fn()}
        onSubmitComment={onSubmit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "查看详情" }));
    const send = screen.getByRole("button", { name: "发送" }) as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "milestone-1" }),
    );
  });
});
