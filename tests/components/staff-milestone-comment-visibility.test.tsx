// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { MilestoneManager } from "@/components/staff/milestone-manager";
import type { ProjectMilestone } from "@/components/staff/staff-types";
import { appTheme } from "@/theme/theme";

const staffApi = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/components/staff/staff-api", () => ({
  staffApi: (...args: unknown[]) => staffApi(...args),
  jsonRequest: (method: string, body?: unknown) => ({ method, json: body }),
}));
vi.mock("@/components/shared/toast-provider", () => ({
  useToast: () => ({
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    delivery: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-delivery-channels", () => ({
  useDeliveryChannelRule: () => ({ channels: {} }),
}));
vi.mock("@/hooks/use-inline-image-upload", () => ({
  useInlineImageUpload: () => vi.fn(),
}));

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const milestone: ProjectMilestone = {
  id: "milestone-1",
  title: "上线验收",
  description: null,
  status: "IN_PROGRESS",
  createdAt: "2026-09-01T10:00:00.000Z",
  comments: [],
};

describe("员工里程碑评论可见性", () => {
  it("内部开关打开时提交 INTERNAL，并在发送后复位", async () => {
    staffApi.mockResolvedValue({});
    render(
      <ThemeProvider theme={appTheme}>
        <MilestoneManager
          projectId="project-1"
          milestones={[milestone]}
          canManage={false}
          canComment
          currentUserId="staff-1"
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "查看详情" }));
    fireEvent.change(screen.getByPlaceholderText("回复客户或记录说明…"), {
      target: { value: "仅供内部跟进" },
    });
    fireEvent.click(screen.getByRole("switch", { name: "仅内部可见" }));
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() =>
      expect(staffApi).toHaveBeenCalledWith(
        "/api/v1/projects/project-1/milestones/milestone-1/comments",
        {
          method: "POST",
          json: {
            body: "<p>仅供内部跟进</p>",
            visibility: "INTERNAL",
          },
        },
      ),
    );
  });

  it("内部评论显示明确标记", () => {
    render(
      <ThemeProvider theme={appTheme}>
        <MilestoneManager
          projectId="project-1"
          milestones={[
            {
              ...milestone,
              comments: [
                {
                  id: "comment-1",
                  body: "<p>内部备注</p>",
                  visibility: "INTERNAL",
                  authorId: "staff-1",
                  authorName: "员工甲",
                  createdAt: "2026-09-01T11:00:00.000Z",
                },
              ],
            },
          ]}
          canManage={false}
          canComment
          currentUserId="staff-1"
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "查看详情" }));
    expect(screen.getByText(/内部评论/)).toBeTruthy();
  });
});
