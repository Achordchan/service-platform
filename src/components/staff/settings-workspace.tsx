"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Box, Tab, Tabs } from "@mui/material";
import { DingTalkTemplateWorkspace } from "@/components/staff/dingtalk-template-workspace";
import { PlatformSettingsHub } from "@/components/staff/platform-settings-hub";
import type { NotificationDeliveryRuleView } from "@/modules/notifications/notification-delivery-rules";
import type {
  MailMessageView,
  MailOutboxSummary,
  MailTemplateView,
  PlatformSettingsView,
} from "@/components/staff/platform-settings-types";
import { ServiceTypeManager } from "@/components/staff/service-type-manager";
import type { ServiceTypeItem } from "@/components/staff/staff-types";
import { SupportPlaybookManager } from "@/components/staff/support-playbook-manager";
import type { SupportReplyPlaybookView } from "@/lib/support-reply-playbooks";

export type SettingsWorkspaceProps = {
  initialSettings: PlatformSettingsView;
  initialMessages: MailMessageView[];
  initialMailOutboxSummary: MailOutboxSummary;
  initialNotificationRules: NotificationDeliveryRuleView[];
  initialTemplates: MailTemplateView[];
  currentAdminEmail: string;
  dingTalkPluginEnabled: boolean;
  dingTalkPluginReady: boolean;
  serviceTypes: ServiceTypeItem[];
  playbooks: SupportReplyPlaybookView[];
};

export type SettingsTab =
  | "platform"
  | "services"
  | "playbooks"
  | "dingtalk";

export function resolveSettingsTab(
  value: string | null,
  dingTalkPluginEnabled: boolean,
): SettingsTab {
  if (value === "services" || value === "playbooks") return value;
  if (value === "dingtalk" && dingTalkPluginEnabled) return value;
  return "platform";
}

export function SettingsWorkspace(props: SettingsWorkspaceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = resolveSettingsTab(
    searchParams.get("tab"),
    props.dingTalkPluginEnabled,
  );

  function selectTab(next: SettingsTab) {
    const nextParams = new URLSearchParams(searchParams.toString());
    if (next === "platform") {
      nextParams.delete("tab");
    } else {
      nextParams.set("tab", next);
    }
    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <>
      <Tabs
        value={tab}
        onChange={(_event, value: SettingsTab) => selectTab(value)}
        variant="scrollable"
        scrollButtons="auto"
      >
        <Tab value="platform" label="平台设置" />
        <Tab value="services" label="服务类型与分类" />
        <Tab value="playbooks" label="回复助手" />
        {props.dingTalkPluginEnabled ? (
          <Tab value="dingtalk" label="钉钉模板" />
        ) : null}
      </Tabs>
      <Box sx={{ pt: 2 }}>
        {tab === "platform" ? (
          <PlatformSettingsHub
            initialSettings={props.initialSettings}
            initialMessages={props.initialMessages}
            initialMailOutboxSummary={props.initialMailOutboxSummary}
            initialNotificationRules={props.initialNotificationRules}
            initialTemplates={props.initialTemplates}
            currentAdminEmail={props.currentAdminEmail}
            dingTalkPluginEnabled={props.dingTalkPluginEnabled}
            dingTalkPluginReady={props.dingTalkPluginReady}
          />
        ) : null}
        {tab === "services" ? (
          <ServiceTypeManager serviceTypes={props.serviceTypes} />
        ) : null}
        {tab === "playbooks" ? (
          <SupportPlaybookManager initialPlaybooks={props.playbooks} />
        ) : null}
        {tab === "dingtalk" ? <DingTalkTemplateWorkspace /> : null}
      </Box>
    </>
  );
}
