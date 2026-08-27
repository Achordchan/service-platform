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
  message: Pick<
    ChatReplyReference,
    "body" | "attachments" | "bodyIsAttachmentPlaceholder"
  >,
) {
  // 只过滤内联与被撤回项：replyTo.attachments 服务端已过滤撤回，
  // 实时选择回复目标时传入的消息对象带 contentRiskStatus，在此兜底
  const files = message.attachments.filter(
    (attachment: {
      inline?: boolean;
      contentRiskStatus?: "PENDING" | "REVOKED" | null;
    }) => !attachment.inline && attachment.contentRiskStatus !== "REVOKED",
  );
  // 「正文是否为纯附件占位」由服务端用过滤前的完整附件列表全等判定并下发，
  // 前端不再对正文做启发式猜测（混合正文、部分失败、撤回缩水都不会误判）
  if (message.bodyIsAttachmentPlaceholder) {
    if (files.length === 0) return "原消息附件已撤回";
    return truncatePlainText(
      `附件：${files
        .map((file) => file.title?.trim() || file.originalName)
        .join("、")}`,
      120,
    );
  }
  const plainText = htmlToPlainText(message.body);
  if (plainText && plainText !== "（附件）") {
    return truncatePlainText(plainText, 120);
  }
  const first = files[0];
  const fileName = first ? first.title?.trim() || first.originalName : "";
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
