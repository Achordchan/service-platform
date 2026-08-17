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
import { ContentRiskStatusLine } from "@/components/shared/content-risk-notice";
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
  contentRiskStatus?: "PENDING" | "REVOKED" | null;
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

const DEFAULT_COLLAPSED_COUNT = 5;

export function MilestoneList({
  milestones,
  emptyText = "尚未设置里程碑",
  renderActions,
  contentRiskEnabled = false,
  collapsible = false,
  collapsedCount = DEFAULT_COLLAPSED_COUNT,
}: {
  milestones: MilestoneListItem[];
  emptyText?: string;
  renderActions?: (milestone: MilestoneListItem) => ReactNode;
  contentRiskEnabled?: boolean;
  /** 条目多时默认折叠（客户视角），避免里程碑随条数增长把页面拉得过长 */
  collapsible?: boolean;
  collapsedCount?: number;
}) {
  const [detail, setDetail] = useState<MilestoneListItem | null>(null);
  const [expanded, setExpanded] = useState(false);
  const shouldCollapse =
    collapsible && milestones.length > collapsedCount && !expanded;
  const visibleMilestones = shouldCollapse
    ? milestones.slice(0, collapsedCount)
    : milestones;

  return (
    <>
      <Paper variant="outlined" sx={{ overflow: "hidden" }}>
        {visibleMilestones.map((milestone, index) => {
          const description = milestone.description ?? "";
          const preview = htmlToPlainText(description);
          const hasImages =
            extractInlineAttachmentIds(description).length > 0 ||
            /<img\b/i.test(description);
          const dateRange = formatDateRange(milestone);
          const revoked = milestone.contentRiskStatus === "REVOKED";
          return (
            <Box
              key={milestone.id}
              sx={{
                p: { xs: 1.25, md: 1.5 },
                display: "grid",
                gridTemplateColumns: {
                  xs: "minmax(0, 1fr)",
                  md: "minmax(0, 1fr) minmax(190px, auto)",
                },
                columnGap: 3,
                rowGap: 1.25,
                borderBottom:
                  index === visibleMilestones.length - 1 && !shouldCollapse
                    ? 0
                    : "1px solid",
                borderColor: "divider",
                alignItems: "start",
              }}
            >
              <Stack spacing={0.75} sx={{ minWidth: 0 }}>
                {revoked ? (
                  <ContentRiskStatusLine
                    status="REVOKED"
                    pluginEnabled={contentRiskEnabled}
                  />
                ) : (
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
                )}
                {!revoked && milestone.contentRiskStatus === "PENDING" ? (
                  <ContentRiskStatusLine
                    status="PENDING"
                    pluginEnabled={contentRiskEnabled}
                  />
                ) : null}
                {!revoked && preview ? (
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
                ) : !revoked && milestone.description ? null : !revoked ? (
                  <Typography color="text.secondary">
                    未填写说明
                  </Typography>
                ) : null}
                {!revoked && hasImages ? (
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
                spacing={0.75}
                sx={{
                  minWidth: 0,
                  pt: { xs: 1.25, md: 0 },
                  borderTop: { xs: "1px solid", md: 0 },
                  borderColor: "divider",
                  alignItems: { xs: "flex-start", md: "flex-end" },
                  textAlign: { xs: "left", md: "right" },
                }}
              >
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    {timestampFormatter.format(new Date(milestone.createdAt))}
                  </Typography>
                </Box>
                {dateRange ? (
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      {dateRange}
                    </Typography>
                  </Box>
                ) : null}
                {!revoked && (milestone.description || renderActions) ? (
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
                        color="primary"
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
        {collapsible && milestones.length > collapsedCount ? (
          <Box
            sx={{
              p: 1.25,
              textAlign: "center",
              borderTop: "1px solid",
              borderColor: "divider",
            }}
          >
            <Button
              size="small"
              color="inherit"
              onClick={() => setExpanded((prev) => !prev)}
            >
              {expanded
                ? "收起"
                : `查看全部 ${milestones.length} 个里程碑`}
            </Button>
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
