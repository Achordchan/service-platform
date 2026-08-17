import { Stack, Typography } from "@mui/material";
import { PageContainer } from "@/components/shared/page-container";
import AccessTimeRoundedIcon from "@mui/icons-material/AccessTimeRounded";
import BusinessCenterOutlinedIcon from "@mui/icons-material/BusinessCenterOutlined";
import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";
import HourglassEmptyOutlinedIcon from "@mui/icons-material/HourglassEmptyOutlined";
import PauseCircleOutlineOutlinedIcon from "@mui/icons-material/PauseCircleOutlineOutlined";
import SupportAgentOutlinedIcon from "@mui/icons-material/SupportAgentOutlined";
import { EmptyState } from "@/components/shared/content-state";
import {
  RecentProjectsList,
  type RecentProjectItem,
} from "@/components/shared/recent-projects-list";
import { RealtimeRouteRefresh } from "@/components/shared/realtime-route-refresh";
import { StatCard } from "@/components/shared/stat-card";
import { DashboardCharts } from "@/components/staff/dashboard-charts";
import { StaffPageHeading } from "@/components/staff/staff-page-heading";
import { requireUserWithAccess } from "@/lib/session";
import { getDashboardSlaSummary } from "@/modules/dashboard/dashboard-analytics-service";
import { listProjects } from "@/modules/projects/project-service";

export const metadata = {
  title: "概览",
};

export default async function StaffDashboardPage() {
  const { actor } = await requireUserWithAccess();
  const now = new Date();

  const [projects, slaSummary] = await Promise.all([
    listProjects(actor),
    getDashboardSlaSummary(actor, now),
  ]);
  const slaBreached = slaSummary.breached;
  const slaAtRisk = slaSummary.atRisk;

  const activeCount = projects.filter((p) => p.status === "ACTIVE").length;
  const draftCount = projects.filter((p) => p.status === "DRAFT").length;
  const pausedCount = projects.filter((p) => p.status === "PAUSED").length;
  const totalRequests = projects.reduce(
    (sum, project) => sum + project._count.requests,
    0,
  );

  const recentItems: RecentProjectItem[] = projects.slice(0, 6).map((project) => ({
    id: project.id,
    title: project.title,
    subtitle: project.customerSpace.name,
    status: project.status,
    updatedAt: project.updatedAt.toISOString(),
    href: `/staff/projects/${project.id}`,
  }));

  return (
    <PageContainer>
      <Stack spacing={2.5}>
        <RealtimeRouteRefresh mode="project-list" />
        <StaffPageHeading title="概览" description="项目与服务请求的整体情况" />

        <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap" }}>
          <StatCard
            label="进行中项目"
            value={activeCount}
            icon={<BusinessCenterOutlinedIcon />}
            tone="primary"
            href="/staff/projects?status=ACTIVE"
          />
          <StatCard
            label="待接入项目"
            value={draftCount}
            icon={<HourglassEmptyOutlinedIcon />}
            tone="neutral"
            href="/staff/projects?status=DRAFT"
          />
          <StatCard
            label="已暂停项目"
            value={pausedCount}
            icon={<PauseCircleOutlineOutlinedIcon />}
            tone="warning"
            href="/staff/projects?status=PAUSED"
          />
          <StatCard
            label="服务请求总数"
            value={totalRequests}
            icon={<SupportAgentOutlinedIcon />}
            tone="success"
            href="/staff/requests"
          />
          {(slaBreached > 0 || slaAtRisk > 0) && (
            <>
              <StatCard
                label="SLA 已超时"
                value={slaBreached}
                icon={<ErrorOutlineRoundedIcon />}
                tone={slaBreached > 0 ? "warning" : "neutral"}
                href="/staff/requests?sla=breached"
              />
              <StatCard
                label="SLA 即将超时"
                value={slaAtRisk}
                icon={<AccessTimeRoundedIcon />}
                tone={slaAtRisk > 0 ? "warning" : "neutral"}
                href="/staff/requests?sla=at_risk"
              />
            </>
          )}
        </Stack>

        <DashboardCharts />

        <Stack spacing={1.5}>
          <Typography variant="h3">最近更新的项目</Typography>
          {recentItems.length > 0 ? (
            <RecentProjectsList items={recentItems} />
          ) : (
            <EmptyState
              title="暂无项目"
              description="项目创建后将在此显示。"
            />
          )}
        </Stack>
      </Stack>
    </PageContainer>
  );
}
