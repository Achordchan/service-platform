import {
  Box,
  Stack,
  Typography,
} from "@mui/material";
import CheckOutlinedIcon from "@mui/icons-material/CheckOutlined";
import type { ProjectMilestone } from "@/components/customer/customer-types";
import { statusLabel } from "@/components/shared/status-indicator";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function formatRange(milestone: ProjectMilestone) {
  const start = milestone.startDate
    ? dateFormatter.format(new Date(milestone.startDate))
    : null;
  const end = milestone.endDate
    ? dateFormatter.format(new Date(milestone.endDate))
    : null;
  if (start && end && start !== end) return `${start} — ${end}`;
  return start || end || "时间待确认";
}

function MilestoneMarker({ milestone }: { milestone: ProjectMilestone }) {
  const completed = milestone.status === "COMPLETED";
  const active = milestone.status === "IN_PROGRESS";
  const color = completed ? "#16a466" : active ? "#1677ff" : "#98a2b3";

  return (
    <Box
      sx={{
        position: "relative",
        zIndex: 1,
        display: "grid",
        placeItems: "center",
        width: 28,
        height: 28,
        borderRadius: "50%",
        border: "2px solid",
        borderColor: color,
        bgcolor: "background.paper",
        color,
        flex: "0 0 auto",
      }}
    >
      {completed ? (
        <CheckOutlinedIcon sx={{ fontSize: 18 }} />
      ) : active ? (
        <Box
          sx={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            bgcolor: color,
          }}
        />
      ) : null}
    </Box>
  );
}

export function MilestoneTimeline({
  milestones,
}: {
  milestones: ProjectMilestone[];
}) {
  return (
    <Stack>
      {milestones.map((milestone, index) => (
        <Stack
          key={milestone.id}
          direction="row"
          spacing={2.5}
          sx={{ position: "relative", pb: index === milestones.length - 1 ? 0 : 3.5 }}
        >
          {index < milestones.length - 1 ? (
            <Box
              sx={{
                position: "absolute",
                left: 13,
                top: 28,
                bottom: 0,
                width: 2,
                bgcolor: "#e5e7eb",
              }}
            />
          ) : null}
          <MilestoneMarker milestone={milestone} />
          <Box sx={{ flex: 1, minWidth: 0, pt: 0.2 }}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={0.75}
              sx={{
                alignItems: { xs: "flex-start", sm: "center" },
                justifyContent: "space-between",
              }}
            >
              <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                <Typography sx={{ fontWeight: 650 }}>
                  {milestone.title}
                </Typography>
                <Typography
                  variant="body2"
                  color={
                    milestone.status === "COMPLETED"
                      ? "success.main"
                      : milestone.status === "IN_PROGRESS"
                        ? "primary.main"
                        : "text.secondary"
                  }
                >
                  {statusLabel(milestone.status)}
                </Typography>
              </Stack>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ whiteSpace: "nowrap" }}
              >
                {formatRange(milestone)}
              </Typography>
            </Stack>
            {milestone.description ? (
              <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                {milestone.description}
              </Typography>
            ) : null}
          </Box>
        </Stack>
      ))}
    </Stack>
  );
}
