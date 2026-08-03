// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppConfirmProvider } from "@/components/shared/confirm-provider";
import { ToastProvider } from "@/components/shared/toast-provider";
import { MailMessageGrid } from "@/components/staff/mail-message-grid";
import { PlatformSettingsManager } from "@/components/staff/platform-settings-manager";
import type {
  MailMessageView,
  MailOutboxSummary,
  PlatformSettingsView,
} from "@/components/staff/platform-settings-types";
import { appTheme } from "@/theme/theme";

const staffApiMock = vi.hoisted(() => vi.fn());
const jsonRequestMock = vi.hoisted(() =>
  vi.fn((method: string, body: unknown) => ({ method, body })),
);

vi.mock("@/components/staff/staff-api", () => ({
  jsonRequest: jsonRequestMock,
  staffApi: staffApiMock,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const initialSettings: PlatformSettingsView = {
  appUrl: "https://service.example.test",
  mailMode: "RESEND",
  mailFrom: "support@example.test",
  hasDedicatedEncryptionKey: true,
  hasResendApiKey: true,
  resendDomain: "example.test",
  resendDomainId: null,
  resendDomainStatus: null,
  resendDnsRecords: [],
  resendWebhookId: null,
  resendWebhookStatus: null,
  hasResendWebhookSecret: false,
  resendLastCheckedAt: null,
  smtpHost: null,
  smtpPort: null,
  smtpUser: null,
  smtpFrom: "",
  smtpSecure: true,
  hasStoredPassword: false,
  smtpHealthStatus: null,
  smtpLastCheckedAt: null,
  smtpLastError: null,
  attachmentMaxSizeMb: 20,
  attachmentAllowedExtensions: "jpg,png,pdf",
  customerReplyAttachmentsEnabled: true,
  standardEmailUnreadDelayEnabled: true,
  emailOtpLoginEnabled: true,
};

const summary: MailOutboxSummary = {
  queued: 0,
  overdue: 0,
  failed: 1,
  cancelled: 0,
  asOf: "2026-07-31T08:10:00.000Z",
};

function createMessage(
  overrides: Partial<MailMessageView> = {},
): MailMessageView {
  return {
    id: "mail-1",
    toEmail: "customer@example.test",
    templateKey: "request_created",
    subject: "服务请求已创建",
    previewText: "我们已收到您的服务请求",
    heading: "服务请求 #REQ-001",
    body: "这里是邮件正文。",
    actionLabel: "查看服务请求",
    actionUrl: "https://service.example.test/requests/REQ-001",
    deliveryMode: "RESEND",
    status: "FAILED",
    errorMessage: "服务商拒绝接收",
    attemptCount: 2,
    lastAttemptAt: "2026-07-31T08:01:00.000Z",
    providerId: null,
    sentAt: null,
    lastEventAt: "2026-07-31T08:02:00.000Z",
    sendAfter: "2026-07-31T08:00:00.000Z",
    createdAt: "2026-07-31T08:00:00.000Z",
    ...overrides,
  };
}

function renderWithProviders(view: React.ReactNode) {
  return render(
    <ThemeProvider theme={appTheme}>
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <AppConfirmProvider>{view}</AppConfirmProvider>
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

function renderManager(messages: MailMessageView[]) {
  return renderWithProviders(
    <PlatformSettingsManager
      initialSettings={initialSettings}
      initialMessages={messages}
      initialMailOutboxSummary={summary}
      currentAdminEmail="admin@example.test"
      sections={["outbox"]}
    />,
  );
}

describe("邮件发送记录 DataGrid", () => {
  it("展示邮件核心信息，并从操作列打开内容弹窗", async () => {
    const message = createMessage();
    renderManager([message]);

    expect(screen.getByRole("grid", { name: "邮件发送记录" })).toBeTruthy();
    expect(screen.getByText(message.toEmail)).toBeTruthy();
    expect(screen.getByText(message.subject)).toBeTruthy();
    expect(screen.getByText("失败")).toBeTruthy();
    expect(screen.getByText(message.errorMessage as string)).toBeTruthy();
    expect(screen.getByText("尝试 2 次")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "查看内容" }));

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "邮件内容" })).toBeTruthy();
    expect(screen.getByText(message.body)).toBeTruthy();
  });

  it("失败邮件保留重试接口，并在完成后刷新列表和汇总", async () => {
    const message = createMessage();
    staffApiMock.mockImplementation((url: string) => {
      if (url.endsWith("/retry")) return Promise.resolve(undefined);
      if (url.endsWith("?limit=50")) return Promise.resolve([message]);
      if (url.endsWith("/summary")) return Promise.resolve(summary);
      return Promise.reject(new Error(`未处理接口：${url}`));
    });
    renderManager([message]);

    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() =>
      expect(staffApiMock).toHaveBeenCalledWith(
        "/api/v1/admin/mail-messages/mail-1/retry",
        { method: "POST", body: {} },
      ),
    );
    await waitFor(() => {
      expect(staffApiMock).toHaveBeenCalledWith(
        "/api/v1/admin/mail-messages?limit=50",
      );
      expect(staffApiMock).toHaveBeenCalledWith(
        "/api/v1/admin/mail-messages/summary",
      );
    });
  });

  it("排队邮件经确认后保留取消接口", async () => {
    const message = createMessage({
      status: "QUEUED",
      errorMessage: null,
      attemptCount: 0,
    });
    staffApiMock.mockImplementation((url: string) => {
      if (url === "/api/v1/admin/mail-messages/mail-1") {
        return Promise.resolve(undefined);
      }
      if (url.endsWith("?limit=50")) return Promise.resolve([message]);
      if (url.endsWith("/summary")) return Promise.resolve(summary);
      return Promise.reject(new Error(`未处理接口：${url}`));
    });
    renderManager([message]);

    expect(screen.getByText("已逾期超过 2 分钟")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(await screen.findByText("取消排队中的邮件？")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认取消" }));

    await waitFor(() =>
      expect(staffApiMock).toHaveBeenCalledWith(
        "/api/v1/admin/mail-messages/mail-1",
        { method: "DELETE" },
      ),
    );
  });

  it("空列表由 DataGrid 显示统一空状态", () => {
    renderWithProviders(
      <MailMessageGrid
        rows={[]}
        asOf={summary.asOf}
        messageAction={null}
        onView={vi.fn()}
        onRetry={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("grid", { name: "邮件发送记录" })).toBeTruthy();
    expect(screen.getByText("暂无邮件记录")).toBeTruthy();
  });
});
