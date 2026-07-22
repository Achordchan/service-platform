"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { Box, Tab, Tabs } from "@mui/material";
import { TabBadgeLabel } from "@/components/shared/tab-badge-label";
import {
  countProjectRequestUnread,
  countProjectScopeUnread,
  countProjectUpdateUnread,
  useUnreadNotifications,
} from "@/hooks/use-unread-notifications";

export type ProjectTabKey =
  | "overview"
  | "milestones"
  | "updates"
  | "requests"
  | "files";

const tabs: Array<{ value: ProjectTabKey; label: string }> = [
  { value: "overview", label: "项目概览" },
  { value: "milestones", label: "里程碑" },
  { value: "updates", label: "进度动态" },
  { value: "requests", label: "服务请求" },
  { value: "files", label: "文件资料" },
];

export function ProjectTabs({
  projectId,
  activeTab,
  requestIds = [],
  milestonesEnabled = true,
  updatesEnabled = true,
  requestsEnabled = true,
  filesEnabled = true,
}: {
  projectId: string;
  activeTab: ProjectTabKey;
  requestIds?: string[];
  milestonesEnabled?: boolean;
  updatesEnabled?: boolean;
  requestsEnabled?: boolean;
  filesEnabled?: boolean;
}) {
  const { unread, refresh } = useUnreadNotifications();
  const requestIdSet = new Set(requestIds);
  const updateCount = countProjectUpdateUnread(unread, projectId);
  const requestCount = countProjectRequestUnread(unread, projectId, requestIdSet);
  const projectScopeCounts = useMemo(
    () => ({
      overview: countProjectScopeUnread(unread, projectId, "overview"),
      updates: updateCount,
      milestones: countProjectScopeUnread(unread, projectId, "milestones"),
      files: countProjectScopeUnread(unread, projectId, "files"),
    }),
    [projectId, unread, updateCount],
  );

  useEffect(() => {
    if (activeTab === "requests") return;
    const scope = activeTab as keyof typeof projectScopeCounts;
    if ((projectScopeCounts[scope] ?? 0) === 0) return;
    let cancelled = false;
    async function markProjectScope() {
      try {
        const response = await fetch("/api/v1/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            projectScope: scope,
          }),
        });
        if (!response.ok || cancelled) return;
        window.dispatchEvent(
          new CustomEvent("notifications-updated", {
            detail: { projectId, projectScope: scope },
          }),
        );
        await refresh();
      } catch {
        // ignore
      }
    }
    void markProjectScope();
    return () => {
      cancelled = true;
    };
  }, [activeTab, projectId, projectScopeCounts, refresh]);

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
        {tabs
          .filter((tab) => {
            if (tab.value === "milestones") return milestonesEnabled;
            if (tab.value === "updates") return updatesEnabled;
            if (tab.value === "requests") return requestsEnabled;
            if (tab.value === "files") return filesEnabled;
            return true;
          })
          .map((tab) => {
          let count = 0;
          if (tab.value === "requests") count = requestCount;
          else count = projectScopeCounts[tab.value as keyof typeof projectScopeCounts] ?? 0;
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
