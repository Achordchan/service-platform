// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { ProjectUpdates } from "@/components/customer/project-updates";
import type { ProjectUpdate } from "@/components/customer/customer-types";
import { appTheme } from "@/theme/theme";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/components/shared/toast-provider", () => ({
  useToast: () => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }),
}));

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(cleanup);

const updates: ProjectUpdate[] = ["update-a", "update-b"].map((id, index) => ({
  id,
  title: `动态 ${index + 1}`,
  body: `<p>正文 ${index + 1}</p>`,
  authorName: "服务人员",
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
  comments: [],
}));

describe("客户动态评论草稿", () => {
  it("关闭一条详情再打开另一条时清空共享评论草稿", async () => {
    render(
      <ThemeProvider theme={appTheme}>
        <ProjectUpdates updates={updates} projectId="project-1" />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "查看详情" })[0]!);
    const input = screen.getByPlaceholderText("向服务人员留言…");
    fireEvent.change(input, { target: { value: "上一条的草稿" } });
    expect((input as HTMLTextAreaElement).value).toBe("上一条的草稿");

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getAllByRole("button", { name: "查看详情" })[1]!);
    expect(
      (screen.getByPlaceholderText("向服务人员留言…") as HTMLTextAreaElement)
        .value,
    ).toBe("");
  });
});
