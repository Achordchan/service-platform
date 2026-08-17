// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewRequestForm } from "@/components/customer/new-request-form";
import { RequestReplyForm } from "@/components/customer/request-reply-form";
import { RequestReplyComposer } from "@/components/staff/request-reply-composer";

const apiRequestMock = vi.hoisted(() => vi.fn());
const staffApiMock = vi.hoisted(() => vi.fn());
const routerPushMock = vi.hoisted(() => vi.fn());
const routerRefreshMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const toastWarningMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPushMock,
    back: vi.fn(),
    refresh: routerRefreshMock,
  }),
}));

vi.mock("@/lib/api-client", () => ({
  apiRequest: apiRequestMock,
  jsonRequest: (method: string, body?: unknown) => ({ method, json: body }),
}));

vi.mock("@/components/staff/staff-api", () => ({
  staffApi: staffApiMock,
  jsonRequest: (method: string, body?: unknown) => ({ method, json: body }),
}));

vi.mock("@/components/shared/toast-provider", () => ({
  useToast: () => ({
    success: toastSuccessMock,
    warning: toastWarningMock,
    error: toastErrorMock,
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
      allowedExtensions: ["txt"],
      customerReplyAttachmentsEnabled: true,
      accept: ".txt",
    },
    loading: false,
    validateFiles: (files: File[]) => ({ accepted: files, error: "" }),
  }),
}));

vi.mock("@/hooks/use-inline-image-upload", () => ({
  useInlineImageUpload: () => vi.fn(),
}));

vi.mock("@/hooks/use-request-realtime", () => ({
  markRequestLocalMutation: vi.fn(),
}));

vi.mock("@/components/shared/file-picker", () => ({
  FilePickerButton: ({
    children,
    onFiles,
    disabled,
  }: {
    children: React.ReactNode;
    onFiles: (files: File[]) => void;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() =>
        onFiles([new File(["attachment"], "failed.txt", { type: "text/plain" })])
      }
      onDoubleClick={() => {
        onFiles([new File(["first"], "first.txt", { type: "text/plain" })]);
        onFiles([new File(["second"], "second.txt", { type: "text/plain" })]);
      }}
    >
      {children}
    </button>
  ),
  firstFileRejectionMessage: () => "文件选择失败",
}));

vi.mock("@/components/shared/request-chat-attachments", () => ({
  RequestAttachmentDrafts: ({ files }: { files: File[] }) => (
    <div>{files.map((file) => file.name).join("、")}</div>
  ),
}));

vi.mock("@/components/shared/rich-text-editor", () => ({
  RichTextEditor: ({
    value,
    onChange,
    disabled,
  }: {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <textarea
      aria-label="富文本内容"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

vi.mock("@/components/staff/support-reply-assistant", () => ({
  SupportReplyAssistant: () => null,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("附件上传部分失败", () => {
  it("客户回复连续选择附件时保留两次选择结果", () => {
    render(<RequestReplyForm requestId="request-1" status="IN_PROGRESS" />);

    fireEvent.doubleClick(screen.getByRole("button", { name: "添加附件" }));

    expect(screen.getByText("first.txt、second.txt")).toBeTruthy();
  });

  it("服务请求创建成功后附件失败仍进入已创建请求", async () => {
    apiRequestMock.mockImplementation(async (url: string) => {
      if (url === "/api/v1/projects/project-1/requests") {
        return { id: "request-1", initialMessageId: "message-1" };
      }
      if (url === "/api/v1/attachments") {
        throw new Error("附件上传失败");
      }
      throw new Error(`未处理的请求：${url}`);
    });

    render(
      <NewRequestForm
        projects={[
          {
            id: "project-1",
            title: "测试项目",
            serviceTypeName: "技术支持",
            categories: [{ id: "category-1", name: "故障" }],
          },
        ]}
      />,
    );

    fireEvent.mouseDown(screen.getAllByRole("combobox")[1]!);
    fireEvent.click(await screen.findByRole("option", { name: "故障" }));
    fireEvent.change(screen.getByRole("textbox", { name: "问题标题" }), {
      target: { value: "无法登录" },
    });
    fireEvent.change(screen.getByLabelText("富文本内容"), {
      target: { value: "<p>登录后立即退出</p>" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加附件" }));
    fireEvent.click(screen.getByRole("button", { name: "提交服务请求" }));

    await waitFor(() =>
      expect(routerPushMock).toHaveBeenCalledWith("/customer/requests/request-1"),
    );
    expect(
      apiRequestMock.mock.calls.filter(
        ([url]) => url === "/api/v1/projects/project-1/requests",
      ),
    ).toHaveLength(1);
    expect(toastWarningMock).toHaveBeenCalledWith(
      "服务请求已创建，但附件上传失败：failed.txt。请进入服务请求重新添加。",
    );
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("客户回复已发送后附件失败会清空正文和附件", async () => {
    apiRequestMock.mockImplementation(async (url: string) => {
      if (url === "/api/v1/requests/request-1/messages") {
        return { message: { id: "message-1" } };
      }
      if (url === "/api/v1/attachments") {
        throw new Error("附件上传失败");
      }
      throw new Error(`未处理的请求：${url}`);
    });

    render(<RequestReplyForm requestId="request-1" status="IN_PROGRESS" />);

    fireEvent.change(screen.getByLabelText("富文本内容"), {
      target: { value: "<p>补充信息</p>" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加附件" }));
    fireEvent.click(screen.getByRole("button", { name: "发送回复" }));

    await waitFor(() =>
      expect(toastWarningMock).toHaveBeenCalledWith(
        "回复已发送，但附件上传失败：failed.txt。请重新添加附件。",
      ),
    );
    expect((screen.getByLabelText("富文本内容") as HTMLTextAreaElement).value).toBe(
      "",
    );
    expect(screen.queryByText("failed.txt")).toBeNull();
    expect(routerRefreshMock).toHaveBeenCalledOnce();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("员工回复已发送后附件失败会清空正文和附件", async () => {
    staffApiMock.mockImplementation(async (url: string) => {
      if (url === "/api/v1/requests/request-1/messages") {
        return { message: { id: "message-1" }, deliveryFeedback: {} };
      }
      if (url === "/api/v1/attachments") {
        throw new Error("附件上传失败");
      }
      throw new Error(`未处理的请求：${url}`);
    });

    render(<RequestReplyComposer requestId="request-1" />);

    fireEvent.change(screen.getByLabelText("富文本内容"), {
      target: { value: "<p>处理结果</p>" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加附件" }));
    fireEvent.click(screen.getByRole("button", { name: "发送回复" }));

    await waitFor(() =>
      expect(toastWarningMock).toHaveBeenCalledWith(
        "回复已发送，但附件上传失败：failed.txt。请重新添加附件。",
      ),
    );
    expect((screen.getByLabelText("富文本内容") as HTMLTextAreaElement).value).toBe(
      "",
    );
    expect(screen.queryByText("failed.txt")).toBeNull();
    expect(routerRefreshMock).toHaveBeenCalledOnce();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });
});
