"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { CollapsibleText } from "@/components/shared/collapsible-text";
import { StatusIndicator } from "@/components/shared/status-indicator";
import type { MilestoneStatus } from "@/components/customer/customer-types";
import {
  extractInlineAttachmentIds,
  htmlToPlainText,
} from "@/lib/message-content";

export type MilestoneListItem = {
  id: string;
  title: string;
  description?: string | null;
  status: MilestoneStatus;
  startDate?: string | null;
  endDate?: string | null;
  createdAt: string;
};

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const timestampFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatDateRange(milestone: MilestoneListItem) {
  const start = milestone.startDate
    ? dateFormatter.format(new Date(milestone.startDate))
    : null;
  const end = milestone.endDate
    ? dateFormatter.format(new Date(milestone.endDate))
    : null;
  if (start && end) return `${start} — ${end}`;
  return start ?? end;
}

export function MilestoneList({
  milestones,
  emptyText = "尚未设置里程碑",
  renderActions,
}: {
  milestones: MilestoneListItem[];
  emptyText?: string;
  renderActions?: (milestone: MilestoneListItem) => ReactNode;
}) {
  const [detail, setDetail] = useState<MilestoneListItem | null>(null);

  return (
    <>
      <Paper variant="outlined" sx={{ overflow: "hidden" }}>
        {milestones.map((milestone, index) => {
          const description = milestone.description ?? "";
          const preview = htmlToPlainText(description);
          const hasImages =
            extractInlineAttachmentIds(description).length > 0 ||
            /<img\b/i.test(description);
          const dateRange = formatDateRange(milestone);
          return (
            <Box
              key={milestone.id}
              sx={{
                p: { xs: 2, md: 2.5 },
                display: "grid",
                gridTemplateColumns: {
                  xs: "minmax(0, 1fr)",
                  md: "minmax(0, 1fr) minmax(250px, auto)",
                },
                columnGap: 4,
                rowGap: 2,
                borderBottom:
                  index === milestones.length - 1 ? 0 : "1px solid",
                borderColor: "divider",
                alignItems: "start",
              }}
            >
              <Stack spacing={1.25} sx={{ minWidth: 0 }}>
                <Stack
                  direction="row"
                  spacing={1.5}
                  useFlexGap
                  sx={{ alignItems: "center", flexWrap: "wrap" }}
                >
                  <Typography sx={{ fontWeight: 650 }}>
                    {milestone.title}
                  </Typography>
                  <StatusIndicator status={milestone.status} compact />
                </Stack>
                {preview ? (
                  <Typography
                    color="text.secondary"
                    sx={{
                      lineHeight: 1.7,
                      display: "-webkit-box",
                      WebkitBoxOrient: "vertical",
                      WebkitLineClamp: 2,
                      overflow: "hidden",
                      wordBreak: "break-word",
                    }}
                  >
                    {preview}
                  </Typography>
                ) : milestone.description ? null : (
                  <Typography color="text.secondary">
                    未填写说明
                  </Typography>
                )}
                {hasImages ? (
                  <Stack
                    direction="row"
                    spacing={0.75}
                    sx={{ alignItems: "center", color: "text.secondary" }}
                  >
                    <ImageOutlinedIcon sx={{ fontSize: 17 }} />
                    <Typography variant="body2">
                      包含图片，请查看详情
                    </Typography>
                  </Stack>
                ) : null}
              </Stack>
              <Stack
                spacing={1.5}
                sx={{
                  minWidth: 0,
                  pt: { xs: 1.5, md: 0 },
                  borderTop: { xs: "1px solid", md: 0 },
                  borderColor: "divider",
                  alignItems: { xs: "flex-start", md: "flex-end" },
                  textAlign: { xs: "left", md: "right" },
                }}
              >
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    创建时间
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 0.25 }}>
                    {timestampFormatter.format(new Date(milestone.createdAt))}
                  </Typography>
                </Box>
                {dateRange ? (
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      计划日期
                    </Typography>
                    <Typography variant="body2" sx={{ mt: 0.25 }}>
                      {dateRange}
                    </Typography>
                  </Box>
                ) : null}
                {milestone.description || renderActions ? (
                  <Stack
                    direction="row"
                    spacing={0.75}
                    useFlexGap
                    sx={{
                      width: "100%",
                      alignItems: "center",
                      justifyContent: { xs: "flex-start", md: "flex-end" },
                      flexWrap: "wrap",
                    }}
                  >
                    {milestone.description ? (
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<VisibilityOutlinedIcon />}
                        onClick={() => setDetail(milestone)}
                      >
                        查看详情
                      </Button>
                    ) : null}
                    {renderActions ? renderActions(milestone) : null}
                  </Stack>
                ) : null}
              </Stack>
            </Box>
          );
        })}
        {milestones.length === 0 ? (
          <Box sx={{ p: 5, textAlign: "center" }}>
            <Typography color="text.secondary">{emptyText}</Typography>
          </Box>
        ) : null}
      </Paper>

      <Dialog
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        fullWidth
        maxWidth="md"
        slotProps={{
          paper: { sx: { maxHeight: "calc(100dvh - 48px)" } },
        }}
      >
        <DialogTitle>{detail?.title}</DialogTitle>
        <DialogContent dividers sx={{ overflowY: "auto" }}>
          {detail ? (
            <Stack spacing={2}>
              <Stack
                direction="row"
                spacing={2}
                useFlexGap
                sx={{ alignItems: "center", flexWrap: "wrap" }}
              >
                <StatusIndicator status={detail.status} />
                <Typography variant="body2" color="text.secondary">
                  创建于 {timestampFormatter.format(new Date(detail.createdAt))}
                </Typography>
                {formatDateRange(detail) ? (
                  <Typography variant="body2" color="text.secondary">
                    {formatDateRange(detail)}
                  </Typography>
                ) : null}
              </Stack>
              {detail.description ? (
                <CollapsibleText
                  text={detail.description}
                  collapsible={false}
                />
              ) : null}
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDetail(null)}>关闭</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
