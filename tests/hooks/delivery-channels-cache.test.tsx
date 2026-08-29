// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const staffApiMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/staff/staff-api", () => ({
  staffApi: staffApiMock,
  jsonRequest: (method: string, body?: unknown) => ({ method, json: body }),
}));

vi.mock("@/components/shared/toast-provider", () => ({
  useToast: () => ({
    success: toastSuccessMock,
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    delivery: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import {
  invalidateDeliveryChannels,
  useDeliveryChannelRule,
} from "@/hooks/use-delivery-channels";
import { NotificationDeliveryRulesPanel } from "@/components/staff/notification-delivery-rules-panel";
import type { NotificationDeliveryRuleView } from "@/modules/notifications/notification-delivery-rules";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function RuleProbe() {
  const rule = useDeliveryChannelRule("PROJECT_UPDATE");
  return <div data-testid="probe">{rule ? String(rule.emailEnabled) : "-"}</div>;
}

function channelRule(emailEnabled: boolean) {
  return [
    {
      key: "PROJECT_UPDATE",
      label: "进度动态与评论",
      notificationEnabled: true,
      emailEnabled,
      wechatEnabled: false,
      emailSupported: true,
      wechatSupported: true,
    },
  ];
}

const panelRule = {
  key: "PROJECT_UPDATE",
  category: "项目交付",
  label: "进度动态与评论",
  description: "面向客户发布的项目动态和评论",
  emailSupported: true,
  emailDefaultEnabled: false,
  dingtalkSupported: false,
  wechatSupported: true,
  notificationEnabled: true,
  soundEnabled: true,
  emailEnabled: true,
  dingtalkEnabled: false,
  wechatEnabled: false,
} as const satisfies NotificationDeliveryRuleView;

afterEach(() => {
  cleanup();
  invalidateDeliveryChannels();
  vi.clearAllMocks();
});

describe("送达通道缓存的失效", () => {
  it("失效后已挂着的提示行也重拉，而不是等下次挂载", async () => {
    staffApiMock.mockResolvedValueOnce(channelRule(true));
    render(<RuleProbe />);
    await waitFor(() =>
      expect(screen.getByTestId("probe").textContent).toBe("true"),
    );

    staffApiMock.mockResolvedValueOnce(channelRule(false));
    invalidateDeliveryChannels();

    // 只清缓存不通知订阅者的话，这里会一直停在 true
    await waitFor(() =>
      expect(screen.getByTestId("probe").textContent).toBe("false"),
    );
    expect(staffApiMock).toHaveBeenCalledTimes(2);
  });

  it("作废前发出的那次请求回来时，不会把旧规则写回缓存", async () => {
    const first = deferred<unknown>();
    staffApiMock.mockReturnValueOnce(first.promise);
    render(<RuleProbe />);
    await waitFor(() => expect(staffApiMock).toHaveBeenCalledOnce());

    // 首次 GET 还在路上时管理员保存了规则
    staffApiMock.mockResolvedValueOnce(channelRule(false));
    invalidateDeliveryChannels();
    // 旧请求这才回来，带的是保存前的规则
    first.resolve(channelRule(true));

    // 只清 cache 不管在途请求的话，它会把 true 写回缓存，作废等于没发生
    await waitFor(() =>
      expect(screen.getByTestId("probe").textContent).toBe("false"),
    );
    expect(staffApiMock).toHaveBeenCalledTimes(2);
  });

  it("保存通知规则后提示行跟着改口，不再照旧通道说话", async () => {
    staffApiMock.mockResolvedValueOnce(channelRule(true));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <RuleProbe />
        <NotificationDeliveryRulesPanel
          initialRules={[panelRule]}
          standardEmailUnreadDelayEnabled={false}
          mailMode="SMTP"
          dingTalkPluginEnabled={false}
          dingTalkPluginReady={false}
        />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("probe").textContent).toBe("true"),
    );

    // 关掉这条规则的邮件通道并保存
    fireEvent.click(screen.getByLabelText("进度动态与评论邮件提醒"));
    staffApiMock.mockResolvedValueOnce([{ ...panelRule, emailEnabled: false }]);
    staffApiMock.mockResolvedValueOnce(channelRule(false));
    fireEvent.click(screen.getByRole("button", { name: "保存通知规则" }));

    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalled());
    // 改完规则不失效缓存，提示行会继续说「会发邮件」，而实际投递已按新规则走
    await waitFor(() =>
      expect(screen.getByTestId("probe").textContent).toBe("false"),
    );
  });
});
