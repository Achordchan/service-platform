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
  TextField,
  Typography,
} from "@mui/material";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { CollapsibleText } from "@/components/shared/collapsible-text";
import { StatusIndicator } from "@/components/shared/status-indicator";
import { ContentRiskStatusLine } from "@/components/shared/content-risk-notice";
import { CommentSection } from "@/components/shared/comment-section";
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
  attachments?: Array<{ id: string }>;
  comments?: MilestoneCommentItem[];
};

/** 与 UpdateCommentListItem 对齐的评论条目（作者/时间/正文/风控状态） */
export type MilestoneCommentItem = {
  id: string;
  body: string;
  visibility?: "CUSTOMER_VISIBLE" | "INTERNAL";
  authorId?: string | null;
  authorName: string;
  authorImage?: string | null;
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
  currentUserId,
  canComment = false,
  composerValue = "",
  onComposerChange,
  composerPlaceholder,
  composerExtra,
  commentBusy = false,
  onSubmitComment,
  onEditComment,
  onDeleteComment,
  canDeleteComment,
  onDetailChange,
}: {
  milestones: MilestoneListItem[];
  emptyText?: string;
  renderActions?: (milestone: MilestoneListItem) => ReactNode;
  contentRiskEnabled?: boolean;
  /** 条目多时默认折叠（客户视角），避免里程碑随条数增长把页面拉得过长 */
  collapsible?: boolean;
  collapsedCount?: number;
  /** 详情弹窗评论区的当前用户 id：只对自己的评论亮出编辑/删除 */
  currentUserId?: string | null;
  /** 详情弹窗评论区能否发言 */
  canComment?: boolean;
  /** 评论输入框的值由父组件持有：切换里程碑或提交后由它清空 */
  composerValue?: string;
  onComposerChange?: (value: string) => void;
  composerPlaceholder?: string;
  /** 员工端的「仅内部可见」等附加控制 */
  composerExtra?: ReactNode;
  /** 发送/编辑/删除进行中：期间禁用输入与按钮 */
  commentBusy?: boolean;
  /** 发送评论：参数是当前打开详情的里程碑 */
  onSubmitComment?: (milestone: MilestoneListItem) => void;
  onEditComment?: (
    milestone: MilestoneListItem,
    comment: MilestoneCommentItem,
  ) => void;
  onDeleteComment?: (
    milestone: MilestoneListItem,
    comment: MilestoneCommentItem,
  ) => void;
  /** 不传时删除默认只限作者本人；员工端可传 canComment 放行管理删除 */
  canDeleteComment?: (comment: MilestoneCommentItem) => boolean;
  /** 切换/关闭详情时通知父组件清空共享评论草稿 */
  onDetailChange?: (milestoneId: string | null) => void;
}) {
  // 详情存 id 而不是对象：router.refresh 换掉 props 后，弹窗内容才跟着
  // 新数据走（不然刚发的评论在弹窗里看不到，还停在刷新前的空列表上）
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = detailId ? milestones.find((item) => item.id === detailId) ?? null : null;
  const [expanded, setExpanded] = useState(false);
  const shouldCollapse =
    collapsible && milestones.length > collapsedCount && !expanded;
  const visibleMilestones = shouldCollapse
    ? milestones.slice(0, collapsedCount)
    : milestones;

  function changeDetail(nextId: string | null) {
    setDetailId(nextId);
    onDetailChange?.(nextId);
  }

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
                {!revoked && (milestone.attachments?.length ?? 0) > 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    {milestone.attachments!.length} 个附件（已收录到项目文件）
                  </Typography>
                ) : null}
                {!revoked && (milestone.comments?.length ?? 0) > 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    {milestone.comments!.length} 条评论
                  </Typography>
                ) : null}
                {!revoked &&
                (milestone.description ||
                  (milestone.comments?.length ?? 0) > 0 ||
                  canComment ||
                  renderActions) ? (
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
                    {milestone.description ||
                    (milestone.comments?.length ?? 0) > 0 ||
                    canComment ? (
                      <Button
                        size="small"
                        color="primary"
                        startIcon={<VisibilityOutlinedIcon />}
                        onClick={() => changeDetail(milestone.id)}
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
        onClose={() => changeDetail(null)}
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
              {/* 评论区常驻详情弹窗；父里程碑被撤回后，评论与输入同时隐藏，
                  不能继续对已撤回内容发言。 */}
              {detail.contentRiskStatus !== "REVOKED" ? (
              <CommentSection
                comments={(detail.comments ?? []).map((comment) => ({
                  ...comment,
                  badge:
                    comment.visibility === "INTERNAL" ? " · 内部评论" : null,
                }))}
                currentUserId={currentUserId}
                contentRiskEnabled={contentRiskEnabled}
                dateFormatter={timestampFormatter}
                emptyText="还没有评论"
                busy={commentBusy}
                // 回调没传就不亮对应按钮（CommentSection 按有无 onEdit/onDelete 判断）
                {...(onEditComment
                  ? {
                      onEdit: (comment: MilestoneCommentItem) =>
                        onEditComment(detail, comment),
                    }
                  : {})}
                {...(onDeleteComment
                  ? {
                      onDelete: (comment: MilestoneCommentItem) =>
                        onDeleteComment(detail, comment),
                    }
                  : {})}
                {...(canDeleteComment
                  ? {
                      canDeleteComment: (comment: MilestoneCommentItem) =>
                        canDeleteComment(comment),
                    }
                  : {})}
                composer={
                  canComment && onComposerChange ? (
                    <Stack spacing={1}>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: "flex-start" }}
                      >
                        <TextField
                          value={composerValue}
                          onChange={(event) => onComposerChange(event.target.value)}
                          fullWidth
                          multiline
                          minRows={2}
                          maxRows={6}
                          size="small"
                          placeholder={composerPlaceholder ?? "写下你的评论…"}
                          disabled={commentBusy}
                        />
                        <Button
                          size="small"
                          variant="contained"
                          onClick={() => {
                            if (detail) onSubmitComment?.(detail);
                          }}
                          disabled={
                            commentBusy || composerValue.trim().length === 0
                          }
                        >
                          发送
                        </Button>
                      </Stack>
                      {composerExtra}
                    </Stack>
                  ) : null
                }
              />
              ) : null}
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => changeDetail(null)}>关闭</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
