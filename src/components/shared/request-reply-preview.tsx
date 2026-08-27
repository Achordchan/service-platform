"use client";

import CloseOutlinedIcon from "@mui/icons-material/CloseOutlined";
import ReplyOutlinedIcon from "@mui/icons-material/ReplyOutlined";
import {
  Box,
  Divider,
  IconButton,
  ListItem,
  ListItemIcon,
  ListItemText,
  Paper,
  Typography,
} from "@mui/material";
import type {
  ChatReplyReference,
  ChatReplyTarget,
} from "@/components/shared/request-chat-types";
import { htmlToPlainText, truncatePlainText } from "@/lib/message-content";

function replyText(
  message: Pick<ChatReplyReference, "body" | "attachments">,
) {
  const plainText = htmlToPlainText(message.body);
  const files = message.attachments.filter(
    (attachment) => !attachment.inline,
  );
  const fileName = files[0]
    ? files[0].title?.trim() || files[0].originalName
    : "";
  // 纯附件回复的正文是「附件：<原文件名列表>」占位（buildAttachmentOnlyMessage
  // 生成）。用当前附件列表精确重构占位串比对：命中才替换为附件当前标题——
  // 用户自己写的以「附件：」开头的真实正文不受影响
  const generatedPlaceholder = `附件：${files
    .map((attachment) => attachment.originalName)
    .join("、")}`;
  if (
    fileName &&
    (!plainText ||
      plainText === "（附件）" ||
      plainText === generatedPlaceholder)
  ) {
    return `附件：${fileName}`;
  }
  if (plainText && plainText !== "（附件）") {
    return truncatePlainText(plainText, 120);
  }
  return fileName ? `附件：${fileName}` : "原消息无文字内容";
}

export function RequestReplyPreview({
  target,
  onCancel,
}: {
  target: ChatReplyTarget;
  onCancel: () => void;
}) {
  return (
    <Paper
      variant="outlined"
      sx={{
        overflow: "hidden",
        bgcolor: "background.default",
      }}
    >
      <ListItem
        secondaryAction={
          <IconButton
            edge="end"
            size="small"
            onClick={onCancel}
            aria-label="取消回复"
          >
            <CloseOutlinedIcon fontSize="small" />
          </IconButton>
        }
        sx={{ py: 0.75, pr: 6 }}
      >
        <ListItemIcon sx={{ minWidth: 34, color: "text.secondary" }}>
          <ReplyOutlinedIcon fontSize="small" />
        </ListItemIcon>
        <Divider orientation="vertical" flexItem sx={{ mr: 1.25 }} />
        <ListItemText
          sx={{ minWidth: 0, my: 0 }}
          primary={`回复 ${target.authorName}`}
          secondary={replyText(target)}
          slotProps={{
            primary: {
              variant: "caption",
              sx: { fontWeight: 650, color: "text.primary" },
            },
            secondary: {
              variant: "body2",
              noWrap: true,
              sx: { mt: 0.15, color: "text.secondary" },
            },
          }}
        />
      </ListItem>
    </Paper>
  );
}

export function RequestQuotedMessage({
  reference,
  unavailable,
  inverted = false,
}: {
  reference?: ChatReplyReference | null;
  unavailable?: boolean;
  inverted?: boolean;
}) {
  if (!reference && !unavailable) return null;
  return (
    <Box
      sx={{
        mb: 1,
        px: 1.1,
        py: 0.85,
        borderRadius: 1.25,
        borderLeft: "3px solid",
        borderColor: inverted
          ? "rgba(255,255,255,0.7)"
          : "rgba(37,99,235,0.55)",
        bgcolor: inverted
          ? "rgba(255,255,255,0.12)"
          : "rgba(15,23,42,0.045)",
        width: "fit-content",
        maxWidth: { xs: "100%", sm: 420, md: 520 },
        minWidth: 0,
      }}
    >
      <Typography
        variant="caption"
        sx={{
          display: "block",
          fontWeight: 650,
          color: inverted ? "rgba(255,255,255,0.9)" : "text.secondary",
        }}
      >
        {reference ? reference.authorName : "原消息"}
      </Typography>
      <Typography
        variant="caption"
        sx={{
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 2,
          overflow: "hidden",
          overflowWrap: "anywhere",
          color: inverted ? "rgba(255,255,255,0.82)" : "text.secondary",
        }}
      >
        {reference ? replyText(reference) : "原消息已不可用"}
      </Typography>
    </Box>
  );
}
