// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectDetailWorkspace } from "@/components/staff/project-detail-workspace";
import type { ProjectDetail } from "@/components/staff/staff-types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/components/staff/staff-api", () => ({
  staffApi: vi.fn(),
  jsonRequest: (method: string, body?: unknown) => ({ method, json: body }),
}));

vi.mock("@/components/shared/toast-provider", () => ({
  useToast: () => ({
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    delivery: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-unread-notifications", () => ({
  useUnreadNotifications: () => ({ unread: [] }),
  useMarkNotificationsRead: () => ({ mutate: vi.fn() }),
  countProjectRequestUnread: () => 0,
  countProjectScopeUnread: () => 0,
  countProjectUpdateUnread: () => 0,
}));

vi.mock("@/hooks/use-inline-image-upload", () => ({
  useInlineImageUpload: () => vi.fn(),
}));

vi.mock("@/components/staff/project-staff-manager", () => ({
  ProjectStaffManager: () => <div />,
}));

vi.mock("@/components/staff/project-file-manager", () => ({
  ProjectFileManager: () => <div />,
}));

vi.mock("@/components/staff/milestone-manager", () => ({
  MilestoneManager: () => <div />,
}));

vi.mock("@/components/staff/request-table", () => ({
  RequestTable: () => <div />,
}));

vi.mock("@/components/staff/sub2api-integration-panel", () => ({
  ExternalContactsPanel: () => <div />,
  Sub2ApiIntegrationPanel: () => <div />,
}));

vi.mock("@/components/staff/universal-integration-panel", () => ({
  UniversalIntegrationPanel: () => <div />,
}));

vi.mock("@/components/shared/rich-text-editor", () => ({
  RichTextEditor: () => <div />,
}));

// jsdom 没有 ResizeObserver，CollapsibleText 靠它判断正文是否溢出
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const comment = (
  id: string,
  authorId: string,
  authorName: string,
  body: string,
) => ({
  id,
  body,
  visibility: "CUSTOMER_VISIBLE" as const,
  authorId,
  authorName,
  createdAt: "2026-08-01T02:00:00.000Z",
  updatedAt: "2026-08-01T02:00:00.000Z",
  hasEditHistory: false,
});

const project = {
  id: "project-1",
  title: "官网改版",
  description: "",
  status: "ACTIVE",
  kind: "STANDARD",
  currentStage: "设计",
  progress: 40,
  startDate: null,
  endDate: null,
  customerSpace: { id: "space-1", name: "客户 A" },
  serviceType: { id: "type-1", name: "建站" },
  staff: [],
  milestones: [],
  attachments: [],
  updates: [
    {
      id: "update-1",
      title: "第一周进展",
      body: "<p>已完成首页设计</p>",
      visibility: "CUSTOMER_VISIBLE" as const,
      authorName: "我",
      createdAt: "2026-08-01T02:00:00.000Z",
      updatedAt: "2026-08-01T02:00:00.000Z",
      hasEditHistory: false,
      attachments: [],
      comments: [
        comment("comment-1", "staff-1", "我", "<p>我的回复</p>"),
        comment("comment-2", "customer-1", "客户 A", "<p>客户的留言</p>"),
      ],
    },
  ],
} as unknown as ProjectDetail;

function workspaceProps(current: ProjectDetail) {
  return {
    project: current,
    requests: [],
    currentUserId: "staff-1",
    canManageDelivery: true,
    canPublishUpdate: true,
    canManageStaff: true,
    canUploadFiles: true,
    canComment: true,
    canEditProject: true,
    staffCandidates: [],
  };
}

function renderWorkspace() {
  render(<ProjectDetailWorkspace {...workspaceProps(project)} />);
  fireEvent.click(screen.getByRole("tab", { name: /进度动态/ }));
}

function openDetail() {
  fireEvent.click(screen.getByRole("button", { name: "查看详情" }));
  return screen.getByRole("dialog");
}

afterEach(() => cleanup());

describe("项目动态评论", () => {
  it("评论区常驻详情弹窗：打开详情就能看到评论，列表行没有单独的评论按钮", () => {
    renderWorkspace();
    // 列表行不再有「评论 N」按钮，评论数只做文字提示
    expect(screen.queryByRole("button", { name: /评论/ })).toBeNull();
    expect(screen.getByText("2 条评论")).toBeDefined();

    const dialog = openDetail();
    expect(within(dialog).getByText("我的回复")).toBeDefined();
    expect(within(dialog).getByText("客户的留言")).toBeDefined();
  });

  it("详情弹窗开着时动态被撤回：评论和输入框跟着消失", async () => {
    const { rerender } = render(
      <ProjectDetailWorkspace {...workspaceProps(project)} />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /进度动态/ }));
    const dialog = openDetail();
    expect(within(dialog).getByText("客户的留言")).toBeDefined();

    rerender(
      <ProjectDetailWorkspace
        {...workspaceProps({
          ...project,
          updates: project.updates.map((update) => ({
            ...update,
            contentRiskStatus: "REVOKED" as const,
          })),
        })}
      />,
    );

    // 撤回后弹窗里的评论与输入框立刻消失（弹窗本身留着，正文换成已撤回提示，
    // 用户自己点关闭）；不能再让人对着已撤回的内容继续发言
    expect(screen.queryByText("客户的留言")).toBeNull();
    expect(screen.queryByPlaceholderText("回复客户或记录说明…")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "发送" })).toBeNull();
    await waitFor(() =>
      expect(within(dialog).queryByText(/评论/)).toBeNull(),
    );
  });

  it("只有自己发的评论给编辑入口，客户的不给", () => {
    renderWorkspace();
    const dialog = openDetail();

    expect(
      within(dialog).getAllByRole("button", { name: "编辑评论" }),
    ).toHaveLength(1);
  });

  it("有评论权限时详情弹窗里直接给评论输入框", () => {
    renderWorkspace();
    const dialog = openDetail();

    expect(
      within(dialog).getByPlaceholderText("回复客户或记录说明…"),
    ).toBeDefined();
    expect(within(dialog).getByRole("button", { name: "发送" })).toBeDefined();
  });
});
