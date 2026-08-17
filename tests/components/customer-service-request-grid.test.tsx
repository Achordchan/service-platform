// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServiceRequestSummary } from "@/components/customer/customer-types";
import { ServiceRequestTable } from "@/components/customer/service-request-table";
import { appTheme } from "@/theme/theme";

const routerPushMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const request: ServiceRequestSummary = {
  id: "request-1",
  number: "REQ-001",
  title: "网站首页需要调整",
  description: "请调整首页布局。",
  priority: "NORMAL",
  status: "PENDING",
  archivedAt: null,
  createdAt: "2026-08-01T08:00:00.000Z",
  updatedAt: "2026-08-01T09:30:00.000Z",
  projectId: "project-1",
  projectTitle: "网站建设项目",
  serviceTypeName: "网站建设",
  category: { id: "category-1", name: "页面调整" },
  assigneeName: "李工程师",
};

function renderTable(
  props: Partial<React.ComponentProps<typeof ServiceRequestTable>> = {},
) {
  return render(
    <ThemeProvider theme={appTheme}>
      <ServiceRequestTable requests={[request]} {...props} />
    </ThemeProvider>,
  );
}

describe("客户服务请求 DataGrid", () => {
  it("桌面端展示核心字段并保留整行跳转", () => {
    renderTable();

    const grid = screen.getByRole("grid", { name: "客户服务请求" });
    expect(grid).toBeTruthy();
    expect(within(grid).getByText(request.number)).toBeTruthy();
    expect(within(grid).getByText(request.title)).toBeTruthy();
    expect(within(grid).getByText(request.projectTitle)).toBeTruthy();
    expect(within(grid).getByText("页面调整")).toBeTruthy();
    expect(within(grid).getByText("待处理")).toBeTruthy();
    expect(
      within(grid).getByText(request.assigneeName as string),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("row", { name: /REQ-001/ }));

    expect(routerPushMock).toHaveBeenCalledWith(
      "/customer/requests/request-1",
    );
  });

  it("compact 模式保留紧凑表格，hideProjectColumn 隐藏项目列", () => {
    renderTable({ compact: true, hideProjectColumn: true });

    expect(
      screen.getByRole("grid", { name: "客户服务请求" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("columnheader", { name: "所属项目" }),
    ).toBeNull();
  });

  it("移动端仍保留原来的详情链接入口", () => {
    renderTable();

    // 响应式双 DOM 同时渲染：桌面标题链接的可访问名只有标题本身，
    // 移动端整行链接的名字还带请求编号——用编号区分，锚定移动端入口
    const mobileLink = screen.getByRole("link", {
      name: /网站首页需要调整\s+REQ-001/,
    });
    expect(mobileLink.getAttribute("href")).toBe(
      "/customer/requests/request-1",
    );
    // 桌面标题链接指向同一详情页
    const desktopLink = screen.getByRole("link", {
      name: "网站首页需要调整",
    });
    expect(desktopLink.getAttribute("href")).toBe(
      "/customer/requests/request-1",
    );
  });

  it("空列表继续使用业务空状态", () => {
    render(
      <ThemeProvider theme={appTheme}>
        <ServiceRequestTable requests={[]} />
      </ThemeProvider>,
    );

    expect(screen.getByText("暂无服务请求")).toBeTruthy();
    expect(screen.queryByRole("grid", { name: "客户服务请求" })).toBeNull();
  });
});
