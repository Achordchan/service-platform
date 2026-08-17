"use client";

import Link from "next/link";
import {
  Box,
  Button,
  Divider,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import type {
  ProjectDetail,
  ServiceRequestSummary,
} from "@/components/customer/customer-types";
import { MilestoneTimeline } from "@/components/customer/milestone-timeline";
import { ProjectUpdates } from "@/components/customer/project-updates";
import { ServiceRequestTable } from "@/components/customer/service-request-table";
import { EmptyState } from "@/components/shared/content-state";


const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function formatDate(value?: string | null) {
  return value ? dateFormatter.format(new Date(value)) : "未设置";
}

export function ProjectOverview({
  project,
  requests,
}: {
  project: ProjectDetail;
  requests: ServiceRequestSummary[];
}) {
  const showMilestones = project.showMilestones !== false;
  const showProgress = project.showProgress !== false;
  const updatesEnabled = project.customerUpdatesEnabled !== false;
  const requestsEnabled = project.customerRequestsEnabled !== false;
  const activeRequests = requests.filter((request) => !request.archivedAt);

  return (
    <Stack spacing={3} sx={{ pt: 2 }}>
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
        <Typography variant="h3">交付概况</Typography>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "1fr",
              sm: "repeat(2, minmax(0, 1fr))",
              lg: "repeat(4, minmax(0, 1fr))",
            },
            gap: 2.5,
            mt: 2.5,
          }}
        >
          <Box>
            <Typography variant="body2" color="text.secondary">
              服务类型
            </Typography>
            <Typography sx={{ mt: 0.75, fontWeight: 650 }}>
              {project.serviceType.name}
            </Typography>
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" color="text.secondary">
              项目负责人
            </Typography>
            <Typography
              title={project.managerNames.join("、") || "待分配"}
              sx={{
                mt: 0.75,
                fontWeight: 650,
                overflowWrap: "anywhere",
              }}
            >
              {project.managerNames.join("、") || "待分配"}
            </Typography>
          </Box>
          <Box>
            <Typography variant="body2" color="text.secondary">
              当前阶段
            </Typography>
            <Typography sx={{ mt: 0.75, fontWeight: 650 }}>
              {project.currentStage || "待启动"}
            </Typography>
          </Box>
          <Box>
            <Typography variant="body2" color="text.secondary">
              服务周期
            </Typography>
            <Typography sx={{ mt: 0.75, fontWeight: 650 }}>
              {formatDate(project.startDate)} — {formatDate(project.endDate)}
            </Typography>
          </Box>
        </Box>
        {showProgress ? (
          <>
            <Divider sx={{ my: 3 }} />
            <Stack spacing={1.25}>
              <Stack direction="row" sx={{ justifyContent: "space-between" }}>
                <Typography sx={{ fontWeight: 650 }}>整体进度</Typography>
                <Typography color="primary.main" sx={{ fontWeight: 650 }}>
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

      {showMilestones || updatesEnabled ? (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "1fr",
              lg:
                showMilestones && updatesEnabled ? "minmax(0, 1fr) minmax(0, 1fr)" : "1fr",
            },
            gap: 4,
          }}
        >
          {showMilestones ? (
            <Box>
              <Typography variant="h3" sx={{ mb: 2.5 }}>
                里程碑
              </Typography>
              {project.milestones.length > 0 ? (
                <MilestoneTimeline
                  milestones={project.milestones}
                  contentRiskEnabled={Boolean(project.contentRiskUiEnabled)}
                />
              ) : (
                <EmptyState
                  title="暂无里程碑"
                  description="项目计划确认后将在此显示。"
                />
              )}
            </Box>
          ) : null}
          {updatesEnabled ? (
            <Box
              sx={{
                pl: { lg: showMilestones ? 4 : 0 },
                borderLeft: { lg: showMilestones ? "1px solid" : 0 },
                borderColor: "divider",
              }}
            >
              <Stack
                direction="row"
                sx={{
                  mb: 0.5,
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <Typography variant="h3">最新进度</Typography>
                {project.updates.length > 3 ? (
                  <Button
                    component={Link}
                    href={`/customer/projects/${project.id}?tab=updates`}
                    size="small"
                  >
                    查看全部
                  </Button>
                ) : null}
              </Stack>
              <ProjectUpdates
                updates={project.updates}
                compact
                contentRiskEnabled={Boolean(project.contentRiskUiEnabled)}
              />
            </Box>
          ) : null}
        </Box>
      ) : null}

      {requestsEnabled ? (
        <>
          <Divider />
          <Box>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1.5}
              sx={{
                mb: 1.5,
                alignItems: { xs: "stretch", sm: "center" },
                justifyContent: "space-between",
              }}
            >
              <Typography variant="h3">最近服务请求</Typography>
              <Button
                component={Link}
                href={`/customer/projects/${project.id}?tab=requests`}
                size="small"
              >
                查看全部
              </Button>
            </Stack>
            <ServiceRequestTable requests={activeRequests.slice(0, 4)} compact />
          </Box>
        </>
      ) : null}
    </Stack>
  );
}
