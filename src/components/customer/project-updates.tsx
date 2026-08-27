"use client";

import { useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import ChatBubbleOutlineOutlinedIcon from "@mui/icons-material/ChatBubbleOutlineOutlined";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import type { ProjectUpdate } from "@/components/customer/customer-types";
import { CollapsibleText } from "@/components/shared/collapsible-text";
import { EmptyState } from "@/components/shared/content-state";
import { ContentRiskStatusLine } from "@/components/shared/content-risk-notice";
import {
  extractInlineAttachmentIds,
  htmlToPlainText,
} from "@/lib/message-content";

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
  compact = false,
  contentRiskEnabled = false,
}: {
  updates: ProjectUpdate[];
  compact?: boolean;
  contentRiskEnabled?: boolean;
}) {
  const [detail, setDetail] = useState<ProjectUpdate | null>(null);
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
                display: "grid",
                gridTemplateColumns: {
                  xs: "minmax(0, 1fr)",
                  md: "minmax(0, 1fr) minmax(190px, auto)",
                },
                columnGap: 3,
                rowGap: 1.25,
                borderBottom:
                  index === visibleUpdates.length - 1 ? 0 : "1px solid",
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
                {!revoked && replyCount > 0 ? (
                  <Stack
                    direction="row"
                    spacing={0.75}
                    sx={{ alignItems: "center", color: "text.secondary" }}
                  >
                    <ChatBubbleOutlineOutlinedIcon sx={{ fontSize: 17 }} />
                    <Typography variant="body2">
                      {replyCount} 条回复
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
                {!revoked && (preview || hasImages || replyCount > 0) ? (
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
                    <Button
                      size="small"
                      color="primary"
                      startIcon={<VisibilityOutlinedIcon />}
                      onClick={() => setDetail(update)}
                    >
                      查看详情
                    </Button>
                  </Stack>
                ) : null}
              </Stack>
            </Box>
          );
        })}
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
              {detail.comments.length > 0 ? (
                <>
                  <Divider />
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: "center" }}
                  >
                    <ChatBubbleOutlineOutlinedIcon
                      sx={{ fontSize: 18, color: "text.secondary" }}
                    />
                    <Typography variant="body2" color="text.secondary">
                      {detail.comments.length} 条回复
                    </Typography>
                  </Stack>
                  <Stack spacing={1.5}>
                    {detail.comments.map((comment) => (
                      <Box
                        key={comment.id}
                        sx={{
                          p: 1.75,
                          borderRadius: 1.5,
                          bgcolor: "action.hover",
                        }}
                      >
                        <Typography variant="body2" sx={{ fontWeight: 650 }}>
                          {comment.authorName}
                          {editedSuffix(comment.createdAt, comment.updatedAt)}
                        </Typography>
                        {comment.contentRiskStatus === "REVOKED" ? (
                          <ContentRiskStatusLine
                            status="REVOKED"
                            pluginEnabled={contentRiskEnabled}
                          />
                        ) : (
                          <>
                            <CollapsibleText
                              text={comment.body}
                              maxLines={6}
                            />
                            <ContentRiskStatusLine
                              status={comment.contentRiskStatus}
                              pluginEnabled={contentRiskEnabled}
                            />
                          </>
                        )}
                      </Box>
                    ))}
                  </Stack>
                </>
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
