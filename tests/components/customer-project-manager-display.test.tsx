// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ProjectDetail,
  ProjectSummary,
} from "@/components/customer/customer-types";
import { ProjectList } from "@/components/customer/project-list";
import { ProjectOverview } from "@/components/customer/project-overview";

vi.mock("@/hooks/use-unread-notifications", () => ({
  useUnreadNotifications: () => ({
    unread: { projectDeliveryCounts: {} },
  }),
  countProjectDeliveryUnread: () => 0,
}));

afterEach(() => cleanup());

function projectSummary(
  managerNames: string[] = ["金晶", "王经理"],
): ProjectSummary {
  return {
    id: "project-1",
    title: "网站 SEO 项目",
    description: "项目说明",
    status: "ACTIVE",
    currentStage: "待启动",
    showMilestones: false,
    showProgress: true,
    customerUpdatesEnabled: false,
    customerRequestsEnabled: false,
    customerFilesEnabled: false,
    startDate: "2026-07-24T00:00:00.000Z",
    endDate: "2027-07-24T00:00:00.000Z",
    updatedAt: "2026-07-24T00:00:00.000Z",
    progress: 0,
    serviceType: { id: "service-1", name: "SEO 项目" },
    customerSpace: { id: "space-1", name: "示例客户" },
    managerNames,
    requestCount: 0,
    updateCount: 0,
  };
}

describe("客户项目负责人展示", () => {
  it("项目卡片展示全部项目负责人", () => {
    render(<ProjectList projects={[projectSummary()]} />);

    expect(screen.getByText("项目负责人")).toBeTruthy();
    expect(screen.getByText("金晶、王经理")).toBeTruthy();
  });

  it("交付概况展示负责人并处理未分配状态", () => {
    const project: ProjectDetail = {
      ...projectSummary([]),
      staff: [],
      milestones: [],
      updates: [],
      attachments: [],
    };
    const { rerender } = render(
      <ProjectOverview project={project} requests={[]} />,
    );

    expect(screen.getByText("项目负责人")).toBeTruthy();
    expect(screen.getByText("待分配")).toBeTruthy();

    rerender(
      <ProjectOverview
        project={{ ...project, managerNames: ["金晶"] }}
        requests={[]}
      />,
    );
    expect(screen.getByText("金晶")).toBeTruthy();
  });
});
