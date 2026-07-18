"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Box,
  Divider,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";
import { ProjectStaffManager } from "@/components/staff/project-staff-manager";
import { ProjectFileManager } from "@/components/staff/project-file-manager";
import { TabBadgeLabel } from "@/components/shared/tab-badge-label";
import {
  countProjectRequestUnread,
  countProjectUpdateUnread,
  useUnreadNotifications,
} from "@/hooks/use-unread-notifications";
import { RequestTable } from "@/components/staff/request-table";
import { StaffStatus } from "@/components/staff/staff-status";
import {
  ExternalContactsPanel,
  Sub2ApiIntegrationPanel,
} from "@/components/staff/sub2api-integration-panel";
import { UniversalIntegrationPanel } from "@/components/staff/universal-integration-panel";
import type {
  MilestoneStatus,
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
  const router = useRouter();
  const showMilestones = project.showMilestones !== false;
  const showProgress = project.showProgress !== false;
  const [tab, setTab] = useState<ProjectTab>("overview");
  const [updatingId, setUpdatingId] = useState("");
  const [error, setError] = useState("");
  const activeTab =
    tab === "milestones" && !showMilestones ? "overview" : tab;
  const { unread, refresh } = useUnreadNotifications();
  const requestIdSet = new Set(requests.map((item) => item.id));
  const updateUnread = countProjectUpdateUnread(unread, project.id);
  const requestUnread = countProjectRequestUnread(
    unread,
    project.id,
    requestIdSet,
  );

  useEffect(() => {
    if (activeTab !== "updates" || updateUnread === 0) return;
    let cancelled = false;
    async function markUpdates() {
      try {
        const response = await fetch("/api/v1/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: project.id,
            projectScope: "updates",
          }),
        });
        if (!response.ok || cancelled) return;
        window.dispatchEvent(
          new CustomEvent("notifications-updated", {
            detail: { projectId: project.id, projectScope: "updates" },
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
  }, [activeTab, project.id, refresh, updateUnread]);


  async function changeMilestoneStatus(
    milestoneId: string,
    status: MilestoneStatus,
  ) {
    setUpdatingId(milestoneId);
    setError("");
    try {
      await staffApi(
        `/api/v1/projects/${project.id}/milestones/${milestoneId}`,
        jsonRequest("PATCH", { status }),
      );
      router.refresh();
    } catch (updateError) {
      setError(
        updateError instanceof Error ? updateError.message : "状态更新失败",
      );
    } finally {
      setUpdatingId("");
    }
  }

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
          <Tab value="overview" label="项目概览" />
          {showMilestones ? (
            <Tab value="milestones" label={`里程碑 ${project.milestones.length}`} />
          ) : null}
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
          <Tab value="files" label={`文件资料 ${project.attachments.length}`} />
          {project.kind === "EXTERNAL_INTEGRATION" ? (
            <Tab value="integration" label="外部接入" />
          ) : null}
          {project.kind === "EXTERNAL_INTEGRATION" ? (
            <Tab value="contacts" label="外部联系人" />
          ) : null}
        </Tabs>
      </Paper>

      {error ? <Alert severity="error">{error}</Alert> : null}

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
                value={project.currentStage || "待确认"}
              />
              <SummaryField
                label="服务周期"
                value={`${formatDate(project.startDate)} — ${formatDate(project.endDate)}`}
              />
            </Box>
            {showProgress ? (
              <>
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
              </>
            ) : null}
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

      {activeTab === "milestones" && showMilestones ? (
        <Paper variant="outlined" sx={{ overflow: "hidden" }}>
          {project.milestones.map((milestone, index) => (
            <Stack
              key={milestone.id}
              direction={{ xs: "column", md: "row" }}
              spacing={2}
              sx={{
                p: { xs: 2, md: 2.5 },
                borderBottom:
                  index === project.milestones.length - 1
                    ? 0
                    : "1px solid",
                borderColor: "divider",
                alignItems: { md: "center" },
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                  <Typography sx={{ fontWeight: 650 }}>{milestone.title}</Typography>
                  <StaffStatus value={milestone.status} compact />
                </Stack>
                <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                  {milestone.description || "未填写说明"}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                  {formatDate(milestone.startDate)} — {formatDate(milestone.endDate)}
                </Typography>
              </Box>
              {canManage ? (
                <TextField
                  select
                  label="里程碑状态"
                  value={milestone.status}
                  onChange={(event) =>
                    changeMilestoneStatus(
                      milestone.id,
                      event.target.value as MilestoneStatus,
                    )
                  }
                  disabled={updatingId === milestone.id}
                  sx={{ width: { xs: "100%", md: 170 } }}
                >
                  <MenuItem value="NOT_STARTED">未开始</MenuItem>
                  <MenuItem value="IN_PROGRESS">进行中</MenuItem>
                  <MenuItem value="COMPLETED">已完成</MenuItem>
                </TextField>
              ) : null}
            </Stack>
          ))}
          {project.milestones.length === 0 ? (
            <Box sx={{ p: 5, textAlign: "center" }}>
              <Typography color="text.secondary">尚未设置里程碑</Typography>
            </Box>
          ) : null}
        </Paper>
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
              <Typography sx={{ mt: 2, lineHeight: 1.8, whiteSpace: "pre-wrap" }}>
                {update.body}
              </Typography>
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
