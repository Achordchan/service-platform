// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectDeliveryActions } from "@/components/staff/project-delivery-actions";
import type { ProjectDetail } from "@/components/staff/staff-types";

const staffApiMock = vi.hoisted(() => vi.fn());
const routerRefreshMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const toastWarningMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: routerRefreshMock }),
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

vi.mock("@/components/shared/delivery-notice", () => ({
  DeliveryNotice: () => <div data-testid="delivery-notice" />,
}));

vi.mock("@/hooks/use-delivery-channels", () => ({
  useDeliveryChannelRule: () => null,
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

vi.mock("@/components/shared/file-picker", () => ({
  FilePickerButton: ({
    children,
    onFiles,
  }: {
    children: React.ReactNode;
    onFiles: (files: File[]) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onFiles([new File(["attachment"], "failed.txt", { type: "text/plain" })])
      }
    >
      {children}
    </button>
  ),
  firstFileRejectionMessage: () => "文件选择失败",
}));

vi.mock("@/components/shared/request-chat-attachments", () => ({
  RequestAttachmentDrafts: ({ drafts }: { drafts: Array<{ file: File }> }) => (
    <div data-testid="drafts">
      {drafts.map((draft) => draft.file.name).join("、")}
    </div>
  ),
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
      aria-label="富文本内容"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

const project = {
  id: "project-1",
  title: "测试项目",
  status: "ACTIVE",
  description: "",
  startDate: null,
  endDate: null,
  currentStage: null,
  showProgress: true,
  showMilestones: true,
  customerUpdatesEnabled: true,
  customerRequestsEnabled: true,
  customerFilesEnabled: true,
  milestones: [],
  updates: [],
  attachments: [],
  staff: [],
} as unknown as ProjectDetail;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function publishUpdateWithFailingAttachment() {
  render(
    <ProjectDeliveryActions
      project={project}
      canManageDelivery
      canPublishUpdate
      canEditProject
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "发布进度" }));
  fireEvent.change(screen.getByRole("textbox", { name: "动态标题" }), {
    target: { value: "本周进展" },
  });
  fireEvent.change(screen.getByLabelText("富文本内容"), {
    target: { value: "<p>已完成联调</p>" },
  });
  fireEvent.click(screen.getByRole("button", { name: "添加附件" }));
  fireEvent.click(screen.getByRole("button", { name: "发布" }));
}

function updateCreateCalls() {
  return staffApiMock.mock.calls.filter(
    ([url]) => url === "/api/v1/projects/project-1/updates",
  );
}

describe("动态附件草稿的生命周期", () => {
  it("直接取消会丢掉挑好的附件，不会跟着下一条动态传上去", async () => {
    staffApiMock.mockImplementation(async (url: string) => {
      if (url === "/api/v1/projects/project-1/updates") return { id: "update-1" };
      return {};
    });

    render(
      <ProjectDeliveryActions
        project={project}
        canManageDelivery
        canPublishUpdate
        canEditProject
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "发布进度" }));
    fireEvent.click(screen.getByRole("button", { name: "添加附件" }));
    expect(screen.getByTestId("drafts").textContent).toBe("failed.txt");

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(await screen.findByRole("button", { name: "发布进度" }));
    await screen.findByText("发布项目进度");

    // 用户取消后并没有再选过这些文件，不该在下一次弹窗里替他做主
    expect(screen.getByTestId("drafts").textContent).toBe("");

    fireEvent.change(screen.getByRole("textbox", { name: "动态标题" }), {
      target: { value: "本周进展" },
    });
    fireEvent.change(screen.getByLabelText("富文本内容"), {
      target: { value: "<p>已完成联调</p>" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发布" }));

    await waitFor(() =>
      expect(toastSuccessMock).toHaveBeenCalledWith("客户进度已发布"),
    );
    expect(
      staffApiMock.mock.calls.filter(([url]) => url === "/api/v1/attachments"),
    ).toHaveLength(0);
  });
});

describe("动态附件上传失败后的原位补传", () => {
  it("实体已建好时保留失败附件并留在弹窗里补传，不重复发布", async () => {
    staffApiMock.mockImplementation(async (url: string) => {
      if (url === "/api/v1/projects/project-1/updates") return { id: "update-1" };
      throw new Error("附件上传失败");
    });

    await publishUpdateWithFailingAttachment();

    // 弹窗不关：正文已经发出去了，但失败的附件还要绑回同一条动态。
    // 关掉再去「文件」重新添加只会建出与该动态无关的普通项目文件。
    await screen.findByText("补传动态附件");
    expect(screen.getByTestId("drafts").textContent).toBe("failed.txt");
    expect(toastWarningMock).toHaveBeenCalledWith(
      "客户进度已发布，但 1 个附件上传失败：failed.txt。已保留在下方，可直接重试。",
    );
    // 已经发过一次通知，补传阶段不该再让人改提醒方式
    expect(screen.queryByTestId("delivery-notice")).toBeNull();

    staffApiMock.mockImplementation(async (url: string) => {
      if (url === "/api/v1/projects/project-1/updates") return { id: "update-2" };
      return {};
    });
    fireEvent.click(screen.getByRole("button", { name: "重试上传" }));

    await waitFor(() =>
      expect(toastSuccessMock).toHaveBeenCalledWith("附件已补传"),
    );
    // 关键不变量：补传只重传附件。少了这条守卫就会再建一条动态、再发一次通知。
    expect(updateCreateCalls()).toHaveLength(1);
    const uploads = staffApiMock.mock.calls.filter(
      ([url]) => url === "/api/v1/attachments",
    );
    expect(uploads).toHaveLength(2);
    expect(screen.queryByText("补传动态附件")).toBeNull();
  });

  it("放弃补传会丢掉草稿，不会挂到下一条动态上", async () => {
    staffApiMock.mockImplementation(async (url: string) => {
      if (url === "/api/v1/projects/project-1/updates") return { id: "update-1" };
      throw new Error("附件上传失败");
    });

    await publishUpdateWithFailingAttachment();
    await screen.findByText("补传动态附件");

    fireEvent.click(screen.getByRole("button", { name: "放弃补传" }));
    // 弹窗有退场动画，等它真的卸载（页面不再被 aria-hidden 遮住）再开下一次
    fireEvent.click(await screen.findByRole("button", { name: "发布进度" }));
    await screen.findByText("发布项目进度");
    expect(screen.getByTestId("drafts").textContent).toBe("");
  });
});
