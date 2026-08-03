// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CustomerAccountManagerDialog } from "@/components/staff/customer-account-manager-dialog";
import { ToastProvider } from "@/components/shared/toast-provider";
import type { CustomerSpaceItem } from "@/components/staff/staff-types";

const staffApiMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/staff/staff-api", () => ({
  jsonRequest: vi.fn(),
  staffApi: staffApiMock,
}));

const target: CustomerSpaceItem = {
  id: "space-1",
  name: "测试客户",
  slug: "test-customer",
  memberLimit: 3,
  status: "ACTIVE",
  ownerId: "user-1",
  ownerName: "客户负责人",
  ownerEmail: "owner@example.test",
  pendingEmailChange: null,
  memberCount: 1,
  projectCount: 1,
  updatedAt: "2026-07-31T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("客户账号详情查询", () => {
  it("弹窗关闭后重新打开复用未过期缓存", async () => {
    staffApiMock.mockResolvedValue({
      id: "space-1",
      name: "测试客户",
      ownerId: "user-1",
      memberLimit: 3,
      memberships: [
        {
          id: "membership-1",
          role: "OWNER",
          createdAt: "2026-07-31T00:00:00.000Z",
          user: {
            id: "user-1",
            name: "客户负责人",
            email: "owner@example.test",
            emailChanges: [],
          },
        },
      ],
      invitations: [],
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const view = (currentTarget: CustomerSpaceItem | null) => (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <CustomerAccountManagerDialog
            target={currentTarget}
            onClose={vi.fn()}
            onChanged={vi.fn()}
          />
        </ToastProvider>
      </QueryClientProvider>
    );

    const rendered = render(view(target));
    await screen.findByText("已使用 1/3 个账号名额");
    rendered.rerender(view(null));
    rendered.rerender(view(target));

    await waitFor(() =>
      expect(screen.getByText("已使用 1/3 个账号名额")).toBeTruthy(),
    );
    expect(staffApiMock).toHaveBeenCalledTimes(1);
  });
});
