"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Divider,
  LinearProgress,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { CollapsibleText } from "@/components/shared/collapsible-text";
import { ProjectStaffManager } from "@/components/staff/project-staff-manager";
import { ProjectFileManager } from "@/components/staff/project-file-manager";
import { MilestoneManager } from "@/components/staff/milestone-manager";
import { TabBadgeLabel } from "@/components/shared/tab-badge-label";
import {
  countProjectRequestUnread,
  countProjectScopeUnread,
  countProjectUpdateUnread,
  useUnreadNotifications,
} from "@/hooks/use-unread-notifications";
import { RequestTable } from "@/components/staff/request-table";
import {
  ExternalContactsPanel,
  Sub2ApiIntegrationPanel,
} from "@/components/staff/sub2api-integration-panel";
import { UniversalIntegrationPanel } from "@/components/staff/universal-integration-panel";
import type {
  ProjectDetail,
  RequestListItem,
  StaffCandidate,
} from "@/components/staff/staff-types";

type ProjectTab =
  | "overview"
  | "milestones"
  | "updates"
  | "requests"
  | "files"
  | "integration"
  | "contacts";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function formatDate(value?: string | null) {
  return value ? dateFormatter.format(new Date(value)) : "未设置";
}

function SummaryField({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <Box>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Box sx={{ mt: 0.75 }}>{value}</Box>
    </Box>
  );
}

export function ProjectDetailWorkspace({
  project,
  requests,
  canManage,
  canEditProject,
  staffCandidates,
}: {
  project: ProjectDetail;
  requests: RequestListItem[];
  canManage: boolean;
  canEditProject: boolean;
  staffCandidates: StaffCandidate[];
}) {
  const [tab, setTab] = useState<ProjectTab>("overview");
  const activeTab = tab;
  const { unread, refresh } = useUnreadNotifications();
  const requestIdSet = new Set(requests.map((item) => item.id));
  const updateUnread = countProjectUpdateUnread(unread, project.id);
  const requestUnread = countProjectRequestUnread(
    unread,
    project.id,
    requestIdSet,
  );
  const projectScopeCounts = useMemo(
    () => ({
      overview: countProjectScopeUnread(unread, project.id, "overview"),
      milestones: countProjectScopeUnread(unread, project.id, "milestones"),
      updates: updateUnread,
      files: countProjectScopeUnread(unread, project.id, "files"),
    }),
    [project.id, unread, updateUnread],
  );

  useEffect(() => {
    if (!(activeTab in projectScopeCounts)) return;
    const scope = activeTab as keyof typeof projectScopeCounts;
    if (projectScopeCounts[scope] === 0) return;
    let cancelled = false;
    async function markProjectScope() {
      try {
        const response = await fetch("/api/v1/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: project.id,
            projectScope: scope,
          }),
        });
        if (!response.ok || cancelled) return;
        window.dispatchEvent(
          new CustomEvent("notifications-updated", {
            detail: { projectId: project.id, projectScope: scope },
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
  }, [activeTab, project.id, projectScopeCounts, refresh]);

  return (
    <Stack spacing={3} sx={{ width: "100%" }}>
      <Paper variant="outlined">
        <Tabs
          value={activeTab}
          onChange={(_, value: ProjectTab) => setTab(value)}
          variant="scrollable"
          scrollButtons={false}
          sx={{ px: { xs: 1, sm: 2 } }}
        >
          <Tab
            value="overview"
            label={
              <TabBadgeLabel
                label="项目概览"
                count={projectScopeCounts.overview}
              />
            }
          />
          <Tab
            value="milestones"
            label={
              <TabBadgeLabel
                label={`里程碑 ${project.milestones.length}`}
                count={projectScopeCounts.milestones}
              />
            }
          />
          <Tab
            value="updates"
            label={
              <TabBadgeLabel
                label={`进度动态 ${project.updates.length}`}
                count={updateUnread}
              />
            }
          />
          <Tab
            value="requests"
            label={
              <TabBadgeLabel
                label={`服务请求 ${requests.length}`}
                count={requestUnread}
              />
            }
          />
          <Tab
            value="files"
            label={
              <TabBadgeLabel
                label={`文件资料 ${project.attachments.length}`}
                count={projectScopeCounts.files}
              />
            }
          />
          {project.kind === "EXTERNAL_INTEGRATION" ? (
            <Tab value="integration" label="外部接入" />
          ) : null}
          {project.kind === "EXTERNAL_INTEGRATION" ? (
            <Tab value="contacts" label="外部联系人" />
          ) : null}
        </Tabs>
      </Paper>

      {activeTab === "overview" ? (
        <Stack spacing={3}>
          <Paper variant="outlined" sx={{ p: { xs: 2.25, md: 3 } }}>
            <Typography variant="h3">交付概况</Typography>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: {
                  xs: "1fr",
                  sm: "repeat(2, minmax(0, 1fr))",
                  lg: "repeat(4, minmax(0, 1fr))",
                },
                gap: 3,
                mt: 3,
              }}
            >
              <SummaryField
                label={project.kind === "EXTERNAL_INTEGRATION" ? "接入对象" : "客户"}
                value={
                  project.kind === "EXTERNAL_INTEGRATION"
                    ? `${project.externalConnectorLabel ?? "外部接入"} 用户`
                    : project.customerSpace.name
                }
              />
              <SummaryField label="服务类型" value={project.serviceType.name} />
              <SummaryField
                label="当前阶段"
                value={project.currentStage || "待启动"}
              />
              <SummaryField
                label="服务周期"
                value={`${formatDate(project.startDate)} — ${formatDate(project.endDate)}`}
              />
            </Box>
            <Divider sx={{ my: 3 }} />
            <Stack spacing={1.25}>
              <Stack direction="row" sx={{ justifyContent: "space-between" }}>
                <Typography sx={{ fontWeight: 650 }}>整体进度</Typography>
                <Typography color="primary.main" sx={{ fontWeight: 700 }}>
                  {project.progress}%
                </Typography>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={project.progress}
                sx={{ height: 7, borderRadius: 4 }}
              />
            </Stack>
          </Paper>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", lg: "1.2fr 0.8fr" },
              gap: 3,
            }}
          >
            <Paper variant="outlined" sx={{ p: { xs: 2.25, md: 3 } }}>
              <Typography variant="h3">项目说明</Typography>
              <Typography
                color={project.description ? "text.primary" : "text.secondary"}
                sx={{ mt: 2, lineHeight: 1.8, whiteSpace: "pre-wrap" }}
              >
                {project.description || "尚未填写项目说明。"}
              </Typography>
            </Paper>
            <Paper variant="outlined" sx={{ p: { xs: 2.25, md: 3 } }}>
              <ProjectStaffManager
                projectId={project.id}
                staff={project.staff}
                candidates={staffCandidates}
                canEdit={canEditProject}
              />
            </Paper>
          </Box>
        </Stack>
      ) : null}

      {activeTab === "milestones" ? (
        <MilestoneManager
          projectId={project.id}
          milestones={project.milestones}
          canManage={canManage}
        />
      ) : null}

      {activeTab === "updates" ? (
        <Stack spacing={2}>
          {project.updates.map((update) => (
            <Paper key={update.id} variant="outlined" sx={{ p: { xs: 2.25, md: 3 } }}>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1}
                sx={{ justifyContent: "space-between" }}
              >
                <Box>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <Typography variant="h3">{update.title}</Typography>
                    {update.visibility === "INTERNAL" ? (
                      <LockOutlinedIcon fontSize="small" color="action" />
                    ) : null}
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                    {update.authorName} · {dateFormatter.format(new Date(update.createdAt))}
                  </Typography>
                </Box>
              </Stack>
              <CollapsibleText text={update.body} maxLines={16} />
              {update.comments.length > 0 ? (
                <Stack spacing={1.5} sx={{ mt: 2.5, pl: 2, borderLeft: "2px solid #e5e7eb" }}>
                  {update.comments.map((comment) => (
                    <Box key={comment.id}>
                      <Typography variant="body2" sx={{ fontWeight: 650 }}>
                        {comment.authorName}
                        {comment.visibility === "INTERNAL" ? " · 内部评论" : ""}
                      </Typography>
                      <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                        {comment.body}
                      </Typography>
                    </Box>
                  ))}
                </Stack>
              ) : null}
            </Paper>
          ))}
          {project.updates.length === 0 ? (
            <Paper variant="outlined" sx={{ p: 5, textAlign: "center" }}>
              <Typography color="text.secondary">尚未发布项目进度</Typography>
            </Paper>
          ) : null}
        </Stack>
      ) : null}

      {activeTab === "requests" ? (
        <RequestTable requests={requests} hideProjectFilter />
      ) : null}
      {activeTab === "files" ? (
        <ProjectFileManager
          projectId={project.id}
          files={project.attachments}
          canUpload={canManage}
        />
      ) : null}
      {activeTab === "integration" && project.kind === "EXTERNAL_INTEGRATION" ? (
        project.externalConnectorKey === "universal-embed-connector" ? (
          <UniversalIntegrationPanel projectId={project.id} canEdit={canEditProject} />
        ) : (
          <Sub2ApiIntegrationPanel projectId={project.id} canEdit={canEditProject} />
        )
      ) : null}
      {activeTab === "contacts" && project.kind === "EXTERNAL_INTEGRATION" ? (
        <ExternalContactsPanel projectId={project.id} />
      ) : null}
    </Stack>
  );
}
