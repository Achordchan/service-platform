// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { RoleGroupManager } from "@/components/staff/role-group-manager";
import {
  TeamManager,
  type StaffInviteView,
  type TeamMemberView,
} from "@/components/staff/team-manager";
import { ToastProvider } from "@/components/shared/toast-provider";

const staffApiMock = vi.hoisted(() => vi.fn());
const jsonRequestMock = vi.hoisted(() =>
  vi.fn((method: string, body: unknown) => ({ method, body })),
);
const routerRefreshMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/staff/staff-api", () => ({
  jsonRequest: jsonRequestMock,
  staffApi: staffApiMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefreshMock }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderWithProviders(view: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{view}</ToastProvider>
    </QueryClientProvider>,
  );
}

const activeRoleGroup = {
  id: "role-1",
  name: "交付人员",
  accessLevel: "TECHNICIAN" as const,
  active: true,
};

// 文件内第一次渲染 MUI 组件时，emotion 要把各组件样式首次注入 <head>、jsdom 逐条解析，
// 外加 React/DataGrid 冷启动 JIT，这笔一次性成本（单跑约 300ms）原本全算进首个用例的
// 5 秒 testTimeout；全量并发时 CPU 被多个 worker 抢，会被放大十倍撞线。这里先把两个
// 管理器及其表单弹窗各渲染一次，让一次性成本落在 beforeAll（独立 hookTimeout）里。
beforeAll(() => {
  renderWithProviders(<RoleGroupManager roleGroups={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "新增角色组" }));
  cleanup();
  renderWithProviders(
    <TeamManager members={[]} invitations={[]} roleGroups={[activeRoleGroup]} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "邀请成员" }));
  cleanup();
});

// 查询尽量收窄到弹窗/表格内：按名称的 getByRole 要对全文档同角色元素逐个计算可访问名称
// （每个后代都走一次 jsdom getComputedStyle），表单字段改用 getByLabelText 直接按 label 关联。
describe("员工与角色组表单", () => {
  it("角色组创建先执行客户端校验，再提交清洗后的数据", async () => {
    staffApiMock.mockResolvedValue({ id: "role-new" });
    renderWithProviders(<RoleGroupManager roleGroups={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "新增角色组" }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.click(dialog.getByRole("button", { name: "保存" }));

    expect(await dialog.findByText("名称至少需要 2 个字符")).toBeTruthy();
    expect(staffApiMock).not.toHaveBeenCalled();

    fireEvent.change(dialog.getByLabelText(/名称/), {
      target: { value: "  技术支持  " },
    });
    fireEvent.change(dialog.getByLabelText(/标识/), {
      target: { value: "support_team" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(staffApiMock).toHaveBeenCalledOnce());
    expect(jsonRequestMock).toHaveBeenCalledWith("POST", {
      name: "技术支持",
      key: "support_team",
      description: "",
      accessLevel: "TECHNICIAN",
      permissions: [],
      active: true,
      sortOrder: 60,
    });
    expect(routerRefreshMock).toHaveBeenCalledOnce();
  });

  it("编辑系统角色组时保留原值并阻止标识字段进入更新", async () => {
    staffApiMock.mockResolvedValue({ id: "role-system" });
    renderWithProviders(
      <RoleGroupManager
        roleGroups={[
          {
            id: "role-system",
            key: "system_technician",
            name: "系统技术人员",
            description: "默认角色组",
            accessLevel: "TECHNICIAN",
            permissions: ["request.reply"],
            isSystem: true,
            active: true,
            sortOrder: 10,
            userCount: 1,
            invitationCount: 0,
            updatedAt: "2026-07-31T00:00:00.000Z",
          },
        ]}
      />,
    );

    const grid = within(screen.getByRole("grid", { name: "角色组" }));
    fireEvent.click(grid.getAllByRole("button", { name: "编辑" })[0]);
    const dialog = within(screen.getByRole("dialog"));
    const nameInput = dialog.getByLabelText(/名称/);
    const keyInput = dialog.getByLabelText(/标识/);
    expect((nameInput as HTMLInputElement).value).toBe("系统技术人员");
    expect((keyInput as HTMLInputElement).disabled).toBe(true);

    fireEvent.change(nameInput, { target: { value: "系统技术支持" } });
    fireEvent.click(dialog.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(staffApiMock).toHaveBeenCalledOnce());
    expect(staffApiMock).toHaveBeenCalledWith(
      "/api/v1/admin/role-groups/role-system",
      expect.anything(),
    );
    expect(jsonRequestMock).toHaveBeenCalledWith("PATCH", {
      name: "系统技术支持",
      key: undefined,
      description: "默认角色组",
      accessLevel: "TECHNICIAN",
      permissions: ["request.reply"],
      active: true,
      sortOrder: 10,
    });
  });

  it("编辑系统角色组时不校验不可修改的历史标识", async () => {
    staffApiMock.mockResolvedValue({ id: "role-system" });
    renderWithProviders(
      <RoleGroupManager
        roleGroups={[
          {
            id: "role-system",
            key: "Legacy-System-Key",
            name: "系统技术人员",
            description: null,
            accessLevel: "TECHNICIAN",
            permissions: [],
            isSystem: true,
            active: true,
            sortOrder: 10,
            userCount: 1,
            invitationCount: 0,
            updatedAt: "2026-07-31T00:00:00.000Z",
          },
        ]}
      />,
    );

    const grid = within(screen.getByRole("grid", { name: "角色组" }));
    fireEvent.click(grid.getAllByRole("button", { name: "编辑" })[0]);
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByLabelText(/名称/), {
      target: { value: "系统技术支持" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(staffApiMock).toHaveBeenCalledOnce());
  });

  it("邀请成员时校验姓名和邮箱并保留默认角色组", async () => {
    const invitation: StaffInviteView = {
      id: "invite-1",
      email: "member@example.test",
      name: "测试成员",
      phone: null,
      company: null,
      jobTitle: null,
      wechat: null,
      location: null,
      platformRole: "TECHNICIAN",
      roleGroupId: activeRoleGroup.id,
      roleGroupName: activeRoleGroup.name,
      expiresAt: "2026-08-07T00:00:00.000Z",
      createdAt: "2026-07-31T00:00:00.000Z",
      invitedByName: "管理员",
    };
    staffApiMock.mockResolvedValue(invitation);
    renderWithProviders(
      <TeamManager
        members={[]}
        invitations={[]}
        roleGroups={[activeRoleGroup]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "邀请成员" }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.click(dialog.getByRole("button", { name: "发送邀请" }));

    expect(await dialog.findByText("姓名至少需要 2 个字符")).toBeTruthy();
    expect(dialog.getByText("请输入有效邮箱")).toBeTruthy();
    expect(staffApiMock).not.toHaveBeenCalled();

    fireEvent.change(dialog.getByLabelText(/姓名/), {
      target: { value: "  测试成员  " },
    });
    fireEvent.change(dialog.getByLabelText(/邮箱/), {
      target: { value: "  member@example.test  " },
    });
    fireEvent.click(dialog.getByRole("button", { name: "发送邀请" }));

    await waitFor(() => expect(staffApiMock).toHaveBeenCalledOnce());
    expect(jsonRequestMock).toHaveBeenCalledWith("POST", {
      name: "测试成员",
      email: "member@example.test",
      roleGroupId: "role-1",
      phone: "",
      company: "",
      jobTitle: "",
      wechat: "",
      website: "",
      location: "",
      contactNotes: "",
    });
  });

  it("编辑成员资料复用同一表单，但不会把邮箱混入更新接口", async () => {
    const member: TeamMemberView = {
      id: "user-1",
      name: "原成员",
      email: "member@example.test",
      pendingEmailChange: null,
      platformRole: "TECHNICIAN",
      phone: null,
      company: null,
      jobTitle: null,
      wechat: null,
      website: null,
      location: null,
      contactNotes: null,
      roleGroupId: activeRoleGroup.id,
      roleGroupName: activeRoleGroup.name,
      projectCount: 0,
      requestCount: 0,
      createdAt: "2026-07-31T00:00:00.000Z",
    };
    staffApiMock.mockResolvedValue({ id: member.id });
    renderWithProviders(
      <TeamManager
        members={[member]}
        invitations={[]}
        roleGroups={[activeRoleGroup]}
      />,
    );

    const grid = within(screen.getByRole("grid", { name: "团队成员" }));
    fireEvent.click(grid.getAllByRole("button", { name: "编辑资料" })[0]);
    const dialog = within(screen.getByRole("dialog"));
    const nameInput = dialog.getByLabelText(/姓名/);
    expect((nameInput as HTMLInputElement).value).toBe("原成员");
    fireEvent.change(nameInput, { target: { value: "更新成员" } });
    fireEvent.click(dialog.getByRole("button", { name: "保存资料" }));

    await waitFor(() => expect(staffApiMock).toHaveBeenCalledOnce());
    expect(staffApiMock).toHaveBeenCalledWith(
      "/api/v1/admin/users/user-1",
      expect.anything(),
    );
    expect(jsonRequestMock).toHaveBeenCalledWith("PATCH", {
      name: "更新成员",
      roleGroupId: "role-1",
      phone: "",
      company: "",
      jobTitle: "",
      wechat: "",
      website: "",
      location: "",
      contactNotes: "",
    });
  });

  it("编辑成员资料时不校验不可修改的历史邮箱", async () => {
    const member: TeamMemberView = {
      id: "user-legacy-email",
      name: "原成员",
      email: "legacy-email",
      pendingEmailChange: null,
      platformRole: "TECHNICIAN",
      phone: null,
      company: null,
      jobTitle: null,
      wechat: null,
      website: null,
      location: null,
      contactNotes: null,
      roleGroupId: activeRoleGroup.id,
      roleGroupName: activeRoleGroup.name,
      projectCount: 0,
      requestCount: 0,
      createdAt: "2026-07-31T00:00:00.000Z",
    };
    staffApiMock.mockResolvedValue({ id: member.id });
    renderWithProviders(
      <TeamManager
        members={[member]}
        invitations={[]}
        roleGroups={[activeRoleGroup]}
      />,
    );

    const grid = within(screen.getByRole("grid", { name: "团队成员" }));
    fireEvent.click(grid.getAllByRole("button", { name: "编辑资料" })[0]);
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByLabelText(/手机/), {
      target: { value: "13800138000" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "保存资料" }));

    await waitFor(() => expect(staffApiMock).toHaveBeenCalledOnce());
  });

  it("待处理邀请使用 DataGrid 展示并保留撤销操作", async () => {
    const invitation: StaffInviteView = {
      id: "invite-pending",
      email: "pending@example.test",
      name: "待加入成员",
      phone: null,
      company: null,
      jobTitle: null,
      wechat: null,
      location: null,
      platformRole: "TECHNICIAN",
      roleGroupId: activeRoleGroup.id,
      roleGroupName: activeRoleGroup.name,
      expiresAt: "2026-08-07T00:00:00.000Z",
      createdAt: "2026-07-31T00:00:00.000Z",
      invitedByName: "管理员",
    };
    staffApiMock.mockResolvedValue(undefined);
    renderWithProviders(
      <TeamManager
        members={[]}
        invitations={[invitation]}
        roleGroups={[activeRoleGroup]}
      />,
    );

    expect(screen.getByRole("grid", { name: "团队成员" })).toBeTruthy();
    const invitationGrid = within(
      screen.getByRole("grid", { name: "待处理邀请" }),
    );
    fireEvent.click(invitationGrid.getAllByRole("button", { name: "撤销" })[0]);

    await waitFor(() => expect(staffApiMock).toHaveBeenCalledOnce());
    expect(staffApiMock).toHaveBeenCalledWith(
      "/api/v1/admin/staff-invitations/invite-pending",
      { method: "DELETE" },
    );
  });
});
