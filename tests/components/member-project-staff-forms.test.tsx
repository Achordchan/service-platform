// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemberManagement } from "@/components/customer/member-management";
import { ProjectStaffManager } from "@/components/staff/project-staff-manager";

const staffApiMock = vi.hoisted(() => vi.fn());
const jsonRequestMock = vi.hoisted(() =>
  vi.fn((method: string, body?: unknown) => ({ method, body })),
);
const routerRefreshMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/staff/staff-api", () => ({
  staffApi: staffApiMock,
  jsonRequest: jsonRequestMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefreshMock }),
}));

vi.mock("@/components/shared/toast-provider", () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: toastErrorMock,
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    delivery: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderWithQueryClient(view: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{view}</QueryClientProvider>,
  );
}

describe("客户成员和项目人员表单", () => {
  it("邀请客户成员时校验邮箱并提交清洗后的 payload", async () => {
    staffApiMock.mockResolvedValue({});
    renderWithQueryClient(
      <MemberManagement
        spaces={[
          {
            id: "space-1",
            name: "测试客户",
            memberLimit: 5,
            members: [],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "邀请成员" }));
    const emailInput = screen.getByLabelText("成员邮箱");
    const inviteForm = document.getElementById("member-invite-form");
    expect(inviteForm).toBeTruthy();

    fireEvent.change(emailInput, { target: { value: "invalid" } });
    fireEvent.submit(inviteForm!);
    expect(await screen.findByText("请输入有效的成员邮箱")).toBeTruthy();
    expect(staffApiMock).not.toHaveBeenCalled();

    fireEvent.change(emailInput, {
      target: { value: "  member@example.test  " },
    });
    fireEvent.submit(inviteForm!);
    await waitFor(() => expect(staffApiMock).toHaveBeenCalledOnce());
    expect(jsonRequestMock).toHaveBeenCalledWith("POST", {
      email: "member@example.test",
    });
    expect(staffApiMock).toHaveBeenCalledWith(
      "/api/v1/admin/customer-spaces/space-1/invitations",
      { method: "POST", body: { email: "member@example.test" } },
    );
  });

  it("分配项目人员时根据平台角色设置默认项目角色并提交选择结果", async () => {
    staffApiMock.mockResolvedValue({});
    renderWithQueryClient(
      <ProjectStaffManager
        projectId="project-1"
        staff={[]}
        candidates={[
          {
            id: "user-admin",
            name: "平台管理员",
            email: "admin@example.test",
            platformRole: "PLATFORM_ADMIN",
          },
          {
            id: "user-tech",
            name: "技术人员",
            email: "tech@example.test",
            platformRole: "TECHNICIAN",
          },
        ]}
        canEdit
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "分配人员" }));
    const userSelect = screen.getByRole("combobox", { name: "协作人员" });
    fireEvent.mouseDown(userSelect);
    fireEvent.click(
      await screen.findByRole("option", {
        name: "平台管理员 · 平台管理员",
      }),
    );
    const roleSelect = screen.getByRole("combobox", { name: "项目角色" });
    expect(roleSelect.textContent).toContain("项目负责人");

    fireEvent.mouseDown(roleSelect);
    fireEvent.click(await screen.findByRole("option", { name: "技术人员" }));
    fireEvent.click(screen.getByRole("button", { name: "确认分配" }));

    await waitFor(() => expect(staffApiMock).toHaveBeenCalledOnce());
    expect(jsonRequestMock).toHaveBeenCalledWith("POST", {
      userId: "user-admin",
      role: "TECHNICIAN",
    });
    expect(routerRefreshMock).toHaveBeenCalledOnce();
  });

  it("移出项目人员先确认并带上本次提醒方式再提交", async () => {
    staffApiMock.mockResolvedValue({});
    renderWithQueryClient(
      <ProjectStaffManager
        projectId="project-1"
        staff={[
          {
            id: "staff-1",
            userId: "user-tech",
            name: "技术人员",
            email: "tech@example.test",
            role: "TECHNICIAN",
          },
        ]}
        candidates={[]}
        canEdit
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "移除" }));
    // 移出同样会给当事人发通知：点完不能直接发出去，得先看清会怎么提醒
    await screen.findByText("移出项目人员");
    expect(staffApiMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "确认移出" }));

    await waitFor(() => expect(staffApiMock).toHaveBeenCalledOnce());
    expect(staffApiMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/projects/project-1/staff/staff-1",
    );
    // 必须是带 body 的 DELETE：回到无 body 的 { method: "DELETE" } 就没地方挂覆盖了
    expect(jsonRequestMock).toHaveBeenCalledWith("DELETE", expect.any(Object));
    expect(staffApiMock.mock.calls[0]?.[1]).not.toEqual({ method: "DELETE" });
    expect(routerRefreshMock).toHaveBeenCalledOnce();
  });
});
