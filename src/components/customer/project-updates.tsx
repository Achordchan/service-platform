import {
  Avatar,
  Box,
  Divider,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import ChatBubbleOutlineOutlinedIcon from "@mui/icons-material/ChatBubbleOutlineOutlined";
import type { ProjectUpdate } from "@/components/customer/customer-types";
import { CollapsibleText } from "@/components/shared/collapsible-text";
import { EmptyState } from "@/components/shared/content-state";
import { ContentRiskStatusLine } from "@/components/shared/content-risk-notice";

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
  const visibleUpdates = compact ? updates.slice(0, 3) : updates;
  if (visibleUpdates.length === 0) {
    return (
      <EmptyState
        title="暂无进度动态"
        description="进度发布后将在此显示。"
      />
    );
  }

  return (
    <Stack spacing={compact ? 0 : 2}>
      {visibleUpdates.map((update, index) =>
        compact ? (
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
        ) : (
          <Paper
            key={update.id}
            variant="outlined"
            sx={{ p: { xs: 2.25, md: 3 } }}
          >
            <Stack direction="row" spacing={1.5}>
              <Avatar
                sx={{
                  width: 38,
                  height: 38,
                  bgcolor: "action.selected",
                  color: "primary.main",
                  fontSize: 15,
                }}
              >
                {update.authorName.slice(0, 1)}
              </Avatar>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={0.5}
                  sx={{ justifyContent: "space-between" }}
                >
                  <Box>
                    {update.contentRiskStatus === "REVOKED" ? (
                      <ContentRiskStatusLine
                        status="REVOKED"
                        pluginEnabled={contentRiskEnabled}
                      />
                    ) : (
                      <Typography sx={{ fontWeight: 650, fontSize: 17 }}>
                        {update.title}
                      </Typography>
                    )}
                    <Typography variant="body2" color="text.secondary">
                      {update.authorName}
                    </Typography>
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    {dateFormatter.format(new Date(update.createdAt))}
                    {editedSuffix(update.createdAt, update.updatedAt)}
                  </Typography>
                </Stack>
                {update.contentRiskStatus === "PENDING" ? (
                  <ContentRiskStatusLine
                    status="PENDING"
                    pluginEnabled={contentRiskEnabled}
                  />
                ) : null}
                {update.contentRiskStatus !== "REVOKED" ? (
                  <CollapsibleText text={update.body} maxLines={12} />
                ) : null}
                {update.contentRiskStatus !== "REVOKED" && update.comments.length > 0 ? (
                  <>
                    <Divider sx={{ my: 2 }} />
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: "center" }}
                    >
                      <ChatBubbleOutlineOutlinedIcon
                        sx={{ fontSize: 18, color: "text.secondary" }}
                      />
                      <Typography variant="body2" color="text.secondary">
                        {update.comments.length} 条回复
                      </Typography>
                    </Stack>
                    <Stack spacing={1.5} sx={{ mt: 1.5 }}>
                      {update.comments.map((comment) => (
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
              </Box>
            </Stack>
          </Paper>
        ),
      )}
    </Stack>
  );
}
