// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupportPlaybookManager } from "@/components/staff/support-playbook-manager";

const staffApiMock = vi.hoisted(() => vi.fn());
const jsonRequestMock = vi.hoisted(() =>
  vi.fn((method: string, body?: unknown) => ({ method, body })),
);
const toastSuccessMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/staff/staff-api", () => ({
  staffApi: staffApiMock,
  jsonRequest: jsonRequestMock,
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

vi.mock("@/components/shared/confirm-provider", () => ({
  useAppConfirm: () => vi.fn().mockResolvedValue(true),
}));

vi.mock("@/components/shared/rich-text-editor", () => ({
  RichTextEditor: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <textarea
      aria-label="指南正文"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const initialPlaybook = {
  key: "diagnostic-guide",
  category: "DIAGNOSTIC" as const,
  title: "网络诊断指南",
  summary: "检查网络连接",
  introduction: "请执行以下操作",
  content: "<p>请执行以下操作</p>",
  steps: ["检查网络"],
  safetyNotes: [],
  active: true,
  sortOrder: 10,
  isBuiltin: false,
  updatedAt: "2026-08-01T00:00:00.000Z",
  deletedAt: null,
};

describe("回复指南管理器", () => {
  it("启用状态通过 mutation 更新 query 缓存", async () => {
    const nextPlaybooks = [{ ...initialPlaybook, active: false }];
    staffApiMock.mockImplementation(async (url: string) => {
      if (url === "/api/v1/admin/support-playbooks") return [initialPlaybook];
      return nextPlaybooks;
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <SupportPlaybookManager initialPlaybooks={[initialPlaybook]} />
      </QueryClientProvider>,
    );

    const stateSwitch = screen.getByRole("switch", {
      name: "网络诊断指南启用状态",
    });
    fireEvent.click(stateSwitch);

    await waitFor(() =>
      expect(
        staffApiMock.mock.calls.some(
          ([url, options]) =>
            url === "/api/v1/admin/support-playbooks/diagnostic-guide" &&
            options?.method === "PATCH" &&
            options?.body?.active === false,
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.getByText("停用")).toBeTruthy());
    expect(toastErrorMock).not.toHaveBeenCalled();
  });
});
