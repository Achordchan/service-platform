// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectFileManager } from "@/components/staff/project-file-manager";
import type { RequestAttachment } from "@/components/staff/staff-types";

const apiRequestMock = vi.hoisted(() => vi.fn());
const routerRefreshMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: routerRefreshMock }),
}));

vi.mock("@/lib/api-client", () => ({
  apiRequest: apiRequestMock,
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

vi.mock("@/hooks/use-attachment-policy", () => ({
  useAttachmentPolicy: () => ({
    policy: {
      maxSizeMb: 20,
      allowedExtensions: ["pdf"],
      customerReplyAttachmentsEnabled: true,
      accept: ".pdf",
    },
    loading: false,
    validateFiles: (files: File[]) => ({ accepted: files, error: "" }),
  }),
}));

function file(overrides: Partial<RequestAttachment> = {}): RequestAttachment {
  return {
    id: "file-1",
    originalName: "合同.pdf",
    title: null,
    note: null,
    previewStatus: null,
    mimeType: "application/pdf",
    size: 2048,
    visibility: "CUSTOMER_VISIBLE",
    createdAt: new Date("2026-08-01T02:00:00.000Z").toISOString(),
    source: "PROJECT",
    pinned: false,
    ...overrides,
  };
}

beforeEach(() => {
  apiRequestMock.mockReset();
  apiRequestMock.mockResolvedValue({});
  routerRefreshMock.mockReset();
});

afterEach(() => cleanup());

describe("项目文件删除入口", () => {
  it("确认后调用删除接口并刷新列表", async () => {
    render(
      <ProjectFileManager projectId="project-1" files={[file()]} canUpload />,
    );

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() =>
      expect(apiRequestMock).toHaveBeenCalledWith(
        "/api/v1/attachments/file-1",
        { method: "DELETE" },
        "文件删除失败",
      ),
    );
    expect(routerRefreshMock).toHaveBeenCalled();
  });

  it("来自工单沟通的文件只给「移出项目文件」，不给删除", () => {
    render(
      <ProjectFileManager
        projectId="project-1"
        files={[file({ id: "file-2", source: "REQUEST", pinned: true })]}
        canUpload
      />,
    );

    expect(
      screen.getByRole("button", { name: "移出项目文件" }),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
  });

  it("删除权限跟着文件归属走：没有发布权限就删不了动态附件", () => {
    render(
      <ProjectFileManager
        projectId="project-1"
        files={[file({ id: "file-3", source: "UPDATE" })]}
        canUpload
        canPublishUpdate={false}
      />,
    );

    expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
  });

  it("没有上传权限的人看不到删除入口", () => {
    render(
      <ProjectFileManager
        projectId="project-1"
        files={[file()]}
        canUpload={false}
      />,
    );

    expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
  });
});
