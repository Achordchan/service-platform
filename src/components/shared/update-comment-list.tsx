"use client";

import type { ReactNode } from "react";
import { Avatar, Box, Stack, Typography } from "@mui/material";
import ChatBubbleOutlineOutlinedIcon from "@mui/icons-material/ChatBubbleOutlineOutlined";
import { CollapsibleText } from "@/components/shared/collapsible-text";
import { ContentRiskStatusLine } from "@/components/shared/content-risk-notice";
import { resolveAvatarSrc } from "@/lib/default-avatar";

export type UpdateCommentListItem = {
  id: string;
  body: string;
  authorId?: string | null;
  authorName: string;
  authorImage?: string | null;
  createdAt: string;
  contentRiskStatus?: "PENDING" | "REVOKED" | null;
  /** 作者名后面的标记，如「内部评论」 */
  badge?: ReactNode;
  /** 时间后面追加的信息，如「重新编辑于…」 */
  meta?: ReactNode;
  /** 行右侧操作区，如编辑按钮 */
  action?: ReactNode;
};

export function CommentAvatar({
  name,
  seed,
  image,
  size = 32,
}: {
  name: string;
  seed?: string | null;
  image?: string | null;
  size?: number;
}) {
  return (
    <Avatar
      src={resolveAvatarSrc(image, name, seed ?? name)}
      alt={name}
      sx={{ width: size, height: size, flexShrink: 0 }}
    />
  );
}

/**
 * 动态评论的统一展示：头像 + 作者/时间行 + 正文，条目之间用分隔线。
 * 员工端与客户端各自组装 items（可见性标记、编辑入口不同），这里只管样式。
 */
export function UpdateCommentList({
  items,
  contentRiskEnabled,
  emptyText = "还没有评论",
  dateFormatter,
}: {
  items: UpdateCommentListItem[];
  contentRiskEnabled: boolean;
  emptyText?: string;
  dateFormatter: Intl.DateTimeFormat;
}) {
  if (items.length === 0) {
    return (
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", color: "text.secondary", py: 1 }}
      >
        <ChatBubbleOutlineOutlinedIcon sx={{ fontSize: 17 }} />
        <Typography variant="body2">{emptyText}</Typography>
      </Stack>
    );
  }
  return (
    <Stack>
      {items.map((item, index) => (
        <Stack
          key={item.id}
          direction="row"
          spacing={1.25}
          sx={{
            alignItems: "flex-start",
            py: 1.25,
            borderTop: index === 0 ? 0 : "1px solid",
            borderColor: "divider",
          }}
        >
          <CommentAvatar
            name={item.authorName}
            seed={item.authorId ?? item.authorName}
            image={item.authorImage}
          />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: "flex-start", justifyContent: "space-between" }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  variant="body2"
                  sx={{ fontWeight: 650, overflowWrap: "anywhere" }}
                >
                  {item.authorName}
                  {item.badge}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {dateFormatter.format(new Date(item.createdAt))}
                  {item.meta}
                </Typography>
              </Box>
              {item.action}
            </Stack>
            {item.contentRiskStatus === "REVOKED" ? (
              <Box sx={{ mt: 0.75 }}>
                <ContentRiskStatusLine
                  status="REVOKED"
                  pluginEnabled={contentRiskEnabled}
                />
              </Box>
            ) : (
              <>
                <CollapsibleText text={item.body} maxLines={6} />
                <ContentRiskStatusLine
                  status={item.contentRiskStatus}
                  pluginEnabled={contentRiskEnabled}
                />
              </>
            )}
          </Box>
        </Stack>
      ))}
    </Stack>
  );
}
