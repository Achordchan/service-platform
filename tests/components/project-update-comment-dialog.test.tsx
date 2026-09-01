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

afterEach(() => cleanup());

describe("项目动态评论", () => {
  it("评论开在弹窗里，不在列表行内展开", () => {
    renderWorkspace();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /评论 2/ }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("我的回复")).toBeDefined();
    expect(within(dialog).getByText("客户的留言")).toBeDefined();
  });

  it("动态被撤回后评论弹窗跟着关掉，不留评论和输入框", async () => {
    const { rerender } = render(
      <ProjectDetailWorkspace {...workspaceProps(project)} />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /进度动态/ }));
    fireEvent.click(screen.getByRole("button", { name: /评论 2/ }));
    expect(screen.getByRole("dialog")).toBeDefined();

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

    // 撤回后弹窗立刻不再有评论与输入框，随即卸载
    expect(screen.queryByText("客户的留言")).toBeNull();
    expect(screen.queryByPlaceholderText("回复客户或记录说明…")).toBeNull();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("只有自己发的评论给编辑入口，客户的不给", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /评论 2/ }));

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getAllByRole("button", { name: "编辑评论" }),
    ).toHaveLength(1);
  });
});
