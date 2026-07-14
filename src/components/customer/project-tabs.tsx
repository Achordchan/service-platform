"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Box, Tab, Tabs } from "@mui/material";
import { TabBadgeLabel } from "@/components/shared/tab-badge-label";
import {
  countProjectRequestUnread,
  countProjectUpdateUnread,
  useUnreadNotifications,
} from "@/hooks/use-unread-notifications";

export type ProjectTabKey = "overview" | "updates" | "requests" | "files";

const tabs: Array<{ value: ProjectTabKey; label: string }> = [
  { value: "overview", label: "项目概览" },
  { value: "updates", label: "进度动态" },
  { value: "requests", label: "服务请求" },
  { value: "files", label: "文件资料" },
];

export function ProjectTabs({
  projectId,
  activeTab,
  requestIds = [],
}: {
  projectId: string;
  activeTab: ProjectTabKey;
  requestIds?: string[];
}) {
  const { unread, refresh } = useUnreadNotifications();
  const requestIdSet = new Set(requestIds);
  const updateCount = countProjectUpdateUnread(unread, projectId);
  const requestCount = countProjectRequestUnread(unread, projectId, requestIdSet);

  useEffect(() => {
    if (activeTab !== "updates" || updateCount === 0) return;
    let cancelled = false;
    async function markUpdates() {
      try {
        const response = await fetch("/api/v1/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            projectScope: "updates",
          }),
        });
        if (!response.ok || cancelled) return;
        window.dispatchEvent(
          new CustomEvent("notifications-updated", {
            detail: { projectId, projectScope: "updates" },
          }),
        );
        await refresh();
      } catch {
        // ignore
      }
    }
    void markUpdates();
    return () => {
      cancelled = true;
    };
  }, [activeTab, projectId, refresh, updateCount]);

  return (
    <Box
      sx={{
        mt: 3,
        borderBottom: "1px solid",
        borderColor: "divider",
        overflowX: "auto",
      }}
    >
      <Tabs
        value={activeTab}
        variant="scrollable"
        scrollButtons={false}
        sx={{
          minHeight: 50,
          "& .MuiTab-root": {
            minHeight: 50,
            minWidth: { xs: 96, sm: 126 },
            px: { xs: 1.5, sm: 2 },
            fontSize: 15,
          },
        }}
      >
        {tabs.map((tab) => {
          let count = 0;
          if (tab.value === "updates") count = updateCount;
          if (tab.value === "requests") count = requestCount;
          return (
            <Tab
              key={tab.value}
              component={Link}
              href={`/customer/projects/${projectId}?tab=${tab.value}`}
              value={tab.value}
              label={<TabBadgeLabel label={tab.label} count={count} />}
            />
          );
        })}
      </Tabs>
    </Box>
  );
}
