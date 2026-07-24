"use client";

import Link from "next/link";
import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Grid,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import ArrowForwardOutlinedIcon from "@mui/icons-material/ArrowForwardOutlined";
import CalendarMonthOutlinedIcon from "@mui/icons-material/CalendarMonthOutlined";
import PersonOutlineOutlinedIcon from "@mui/icons-material/PersonOutlineOutlined";
import SupportAgentOutlinedIcon from "@mui/icons-material/SupportAgentOutlined";
import UpdateOutlinedIcon from "@mui/icons-material/UpdateOutlined";
import type { ProjectSummary } from "@/components/customer/customer-types";
import { NavigationUnreadBadge } from "@/components/shared/navigation-unread-badge";
import { StatusIndicator } from "@/components/shared/status-indicator";
import {
  countProjectDeliveryUnread,
  useUnreadNotifications,
} from "@/hooks/use-unread-notifications";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function formatDate(value?: string | null) {
  return value ? dateFormatter.format(new Date(value)) : "未设置";
}

function ProjectCard({
  project,
  hasUnreadUpdate,
}: {
  project: ProjectSummary;
  hasUnreadUpdate: boolean;
}) {
  const updatesEnabled = project.customerUpdatesEnabled !== false;
  const requestsEnabled = project.customerRequestsEnabled !== false;
  const showActivitySummary = updatesEnabled || requestsEnabled;

  return (
    <Card
      variant="outlined"
      sx={{
        height: "100%",
        transition: "border-color 160ms ease, box-shadow 160ms ease",
        "&:hover": {
          borderColor: "#b9d5ff",
          boxShadow: "0 14px 36px rgba(16, 24, 40, 0.07)",
        },
      }}
    >
      <CardActionArea
        component={Link}
        href={`/customer/projects/${project.id}`}
        aria-label={
          hasUnreadUpdate ? `${project.title}，有未读更新` : project.title
        }
        sx={{ height: "100%", alignItems: "stretch" }}
      >
        <CardContent
          sx={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            p: { xs: 2.5, md: 3 },
          }}
        >
          <Stack
            direction="row"
            spacing={2}
            sx={{ alignItems: "flex-start", justifyContent: "space-between" }}
          >
            <Box>
              <Chip
                label={project.serviceType.name}
                size="small"
                sx={{
                  mb: 2,
                  bgcolor: "#f2f6ff",
                  color: "#175cd3",
                  fontWeight: 600,
                }}
              />
              <Typography variant="h2" sx={{ fontSize: 21 }}>
                {project.title}
              </Typography>
            </Box>
            <NavigationUnreadBadge visible={hasUnreadUpdate}>
              <ArrowForwardOutlinedIcon
                sx={{ color: "text.secondary", mt: 0.5 }}
              />
            </NavigationUnreadBadge>
          </Stack>

          <Typography
            color="text.secondary"
            sx={{
              mt: 1.5,
              minHeight: 48,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {project.description || "暂无项目说明"}
          </Typography>

          <Stack
            direction="row"
            spacing={0.75}
            sx={{ mt: 1.75, alignItems: "center", minWidth: 0 }}
          >
            <PersonOutlineOutlinedIcon
              sx={{ fontSize: 18, color: "text.secondary", flexShrink: 0 }}
            />
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ flexShrink: 0 }}
            >
              项目负责人
            </Typography>
            <Typography
              variant="body2"
              title={project.managerNames.join("、") || "待分配"}
              sx={{ fontWeight: 650, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {project.managerNames.join("、") || "待分配"}
            </Typography>
          </Stack>

          {project.showProgress !== false ? (
            <Stack spacing={1.3} sx={{ mt: 3 }}>
              <Stack direction="row" sx={{ justifyContent: "space-between" }}>
                <Typography variant="body2" color="text.secondary">
                  {project.currentStage || "待启动"}
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 650 }}>
                  {project.progress}%
                </Typography>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={project.progress}
                sx={{
                  height: 6,
                  borderRadius: 999,
                  bgcolor: "#eef1f5",
                  "& .MuiLinearProgress-bar": { borderRadius: 999 },
                }}
              />
            </Stack>
          ) : (
            <Stack spacing={1.3} sx={{ mt: 3 }}>
              <Typography variant="body2" color="text.secondary">
                {project.currentStage || "待启动"}
              </Typography>
            </Stack>
          )}

          <Stack
            direction="row"
            sx={{
              mt: 2.5,
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <StatusIndicator status={project.status} compact />
            <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
              <CalendarMonthOutlinedIcon
                sx={{ fontSize: 17, color: "text.secondary" }}
              />
              <Typography variant="body2" color="text.secondary">
                {formatDate(project.startDate)} — {formatDate(project.endDate)}
              </Typography>
            </Stack>
          </Stack>

          {showActivitySummary ? (
            <Stack
              direction="row"
              spacing={3}
              sx={{
                mt: 2.5,
                pt: 2.25,
                borderTop: "1px solid",
                borderColor: "divider",
              }}
            >
              {requestsEnabled ? (
                <Stack
                  direction="row"
                  spacing={0.75}
                  sx={{ alignItems: "center" }}
                >
                  <SupportAgentOutlinedIcon
                    sx={{ fontSize: 18, color: "text.secondary" }}
                  />
                  <Typography variant="body2" color="text.secondary">
                    {project.requestCount} 个服务请求
                  </Typography>
                </Stack>
              ) : null}
              {updatesEnabled ? (
                <Stack
                  direction="row"
                  spacing={0.75}
                  sx={{ alignItems: "center" }}
                >
                  <UpdateOutlinedIcon
                    sx={{ fontSize: 18, color: "text.secondary" }}
                  />
                  <Typography variant="body2" color="text.secondary">
                    {project.updateCount} 条进度
                  </Typography>
                </Stack>
              ) : null}
            </Stack>
          ) : null}
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

export function ProjectList({ projects }: { projects: ProjectSummary[] }) {
  const { unread } = useUnreadNotifications();

  return (
    <Grid container spacing={2.5}>
      {projects.map((project) => (
        <Grid key={project.id} size={{ xs: 12, md: 6, xl: 4 }}>
          <ProjectCard
            project={project}
            hasUnreadUpdate={
              project.customerUpdatesEnabled !== false &&
              countProjectDeliveryUnread(unread, project.id) > 0
            }
          />
        </Grid>
      ))}
    </Grid>
  );
}
