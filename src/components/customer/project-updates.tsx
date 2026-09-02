"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import type { ProjectUpdate } from "@/components/customer/customer-types";
import { CollapsibleText } from "@/components/shared/collapsible-text";
import { EmptyState } from "@/components/shared/content-state";
import { ContentRiskStatusLine } from "@/components/shared/content-risk-notice";
import { CommentSection } from "@/components/shared/comment-section";
import { useToast } from "@/components/shared/toast-provider";
import { apiRequest, jsonRequest } from "@/lib/api-client";
import {
  escapeHtmlText,
  extractInlineAttachmentIds,
  htmlToPlainText,
} from "@/lib/message-content";

/** 纯文本评论转安全 HTML：转义后保留换行，与小程序端一致。 */
function commentTextToHtml(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return `<p>${escapeHtmlText(trimmed).replace(/\n/g, "<br/>")}</p>`;
}

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function editedSuffix(createdAt: string, updatedAt: string) {
  const wasEdited =
    new Date(updatedAt).getTime() - new Date(createdAt).getTime() > 60_000;
  return wasEdited ? ` · 重新编辑于 ${dateFormatter.format(new Date(updatedAt))}` : "";
}

export function ProjectUpdates({
  updates,
  projectId,
  compact = false,
  contentRiskEnabled = false,
}: {
  updates: ProjectUpdate[];
  projectId?: string;
  compact?: boolean;
  contentRiskEnabled?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [detailId, setDetailId] = useState<string | null>(null);
  // 评论输入由组件持有：切换动态/提交后统一清空
  const [commentText, setCommentText] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const detail = detailId
    ? updates.find((item) => item.id === detailId) ?? null
    : null;

  function openDetail(updateId: string) {
    // 评论输入是跨详情共享的状态：每次换目标先清空，避免把上一条的草稿误发。
    setCommentText("");
    setDetailId(updateId);
  }

  function closeDetail() {
    setCommentText("");
    setDetailId(null);
  }

  async function submitComment(updateId: string) {
    if (!projectId) return;
    const body = commentTextToHtml(commentText);
    if (!body) {
      toast.warning("请输入评论内容");
      return;
    }
    setPostingComment(true);
    try {
      await apiRequest(
        `/api/v1/projects/${projectId}/updates/${updateId}/comments`,
        jsonRequest("POST", { body }),
        "评论发送失败",
      );
      setCommentText("");
      toast.success("评论已发送");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "评论发送失败");
    } finally {
      setPostingComment(false);
    }
  }

  const visibleUpdates = compact ? updates.slice(0, 3) : updates;
  if (visibleUpdates.length === 0) {
    return (
      <EmptyState
        title="暂无进度动态"
        description="进度发布后将在此显示。"
      />
    );
  }

  if (compact) {
    return (
      <Stack spacing={0}>
        {visibleUpdates.map((update, index) => (
          <Box
            key={update.id}
            sx={{
              py: 2,
              borderBottom:
                index === visibleUpdates.length - 1 ? 0 : "1px solid",
              borderColor: "divider",
            }}
          >
            <Stack direction="row" spacing={1.5}>
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  bgcolor: index < 2 ? "primary.main" : "text.disabled",
                  mt: 1,
                  flex: "0 0 auto",
                }}
              />
              <Box sx={{ minWidth: 0 }}>
                {update.contentRiskStatus === "REVOKED" ? (
                  <ContentRiskStatusLine
                    status="REVOKED"
                    pluginEnabled={contentRiskEnabled}
                  />
                ) : (
                  <Typography sx={{ fontWeight: 650 }}>
                    {update.title}
                  </Typography>
                )}
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 0.5 }}
                >
                  {update.authorName} ·{" "}
                  {dateFormatter.format(new Date(update.createdAt))}
                  {editedSuffix(update.createdAt, update.updatedAt)}
                </Typography>
              </Box>
            </Stack>
          </Box>
        ))}
      </Stack>
    );
  }

  return (
    <>
      <Paper variant="outlined" sx={{ overflow: "hidden" }}>
        {visibleUpdates.map((update, index) => {
          const revoked = update.contentRiskStatus === "REVOKED";
          const preview = htmlToPlainText(update.body);
          const hasImages =
            extractInlineAttachmentIds(update.body).length > 0 ||
            /<img\b/i.test(update.body);
          const replyCount = update.comments.length;
          return (
            <Box
              key={update.id}
              sx={{
                p: { xs: 1.25, md: 1.5 },
                borderBottom:
                  index === visibleUpdates.length - 1 ? 0 : "1px solid",
                borderColor: "divider",
              }}
            >
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: {
                    xs: "minmax(0, 1fr)",
                    md: "minmax(0, 1fr) minmax(190px, auto)",
                  },
                  columnGap: 3,
                  rowGap: 1.25,
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
                    <Typography sx={{ fontWeight: 650 }}>
                      {update.title}
                    </Typography>
                  )}
                  {!revoked && update.contentRiskStatus === "PENDING" ? (
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
                      {update.authorName}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      {dateFormatter.format(new Date(update.createdAt))}
                      {editedSuffix(update.createdAt, update.updatedAt)}
                    </Typography>
                  </Box>
                  {!revoked ? (
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
                      {preview || hasImages || replyCount > 0 ? (
                        <Button
                          size="small"
                          color="primary"
                          startIcon={<VisibilityOutlinedIcon />}
                          onClick={() => openDetail(update.id)}
                        >
                          查看详情
                        </Button>
                      ) : null}
                      {/* 评论在详情弹窗里常驻：回复数只做提示，不再单独开弹窗 */}
                      {replyCount > 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          {replyCount} 条评论
                        </Typography>
                      ) : null}
                    </Stack>
                  ) : null}
                </Stack>
              </Box>
            </Box>
          );
        })}
      </Paper>

      <Dialog
        open={Boolean(detail)}
        onClose={closeDetail}
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
                <Typography variant="body2" color="text.secondary">
                  {detail.authorName}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {dateFormatter.format(new Date(detail.createdAt))}
                  {editedSuffix(detail.createdAt, detail.updatedAt)}
                </Typography>
              </Stack>
              {detail.contentRiskStatus === "PENDING" ? (
                <ContentRiskStatusLine
                  status="PENDING"
                  pluginEnabled={contentRiskEnabled}
                />
              ) : null}
              <CollapsibleText text={detail.body} collapsible={false} />
              {/* 评论区常驻详情弹窗：评论跟着内容走，进来就能看能回 */}
              {detail.contentRiskStatus !== "REVOKED" ? (
                <CommentSection
                  comments={detail.comments.map((comment) => ({
                    id: comment.id,
                    body: comment.body,
                    authorId: comment.authorId,
                    authorName: comment.authorName,
                    authorImage: comment.authorImage,
                    createdAt: comment.createdAt,
                    contentRiskStatus: comment.contentRiskStatus,
                    meta: editedSuffix(comment.createdAt, comment.updatedAt),
                  }))}
                  contentRiskEnabled={contentRiskEnabled}
                  dateFormatter={dateFormatter}
                  emptyText="还没有评论"
                  composer={
                    projectId ? (
                      <Box>
                        {postingComment ? (
                          <LinearProgress sx={{ mb: 1 }} />
                        ) : null}
                        <TextField
                          value={commentText}
                          onChange={(event) => setCommentText(event.target.value)}
                          fullWidth
                          multiline
                          minRows={2}
                          maxRows={6}
                          size="small"
                          placeholder="向服务人员留言…"
                          disabled={postingComment}
                        />
                        <Stack
                          direction="row"
                          sx={{ mt: 1, justifyContent: "flex-end" }}
                        >
                          <Button
                            size="small"
                            variant="contained"
                            onClick={() => void submitComment(detail.id)}
                            disabled={postingComment || commentText.trim().length === 0}
                          >
                            发送
                          </Button>
                        </Stack>
                      </Box>
                    ) : null
                  }
                />
              ) : null}
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={closeDetail}>关闭</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
