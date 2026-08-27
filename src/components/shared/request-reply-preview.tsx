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

/**
 * 判定正文是否为纯附件回复的生成占位（「附件：<原文件名列表>」，见
 * buildAttachmentOnlyMessage）。附件可能部分上传失败或被风控撤回，
 * 幸存列表会比生成时短，因此不做全等重构，而是要求「幸存附件的原文件名
 * 全部出现在正文列表里」——真实正文（如「附件：请查看以下材料」）不含
 * 附件文件名，不会被误判。
 */
function isGeneratedAttachmentPlaceholder(
  plainText: string,
  files: Array<{ originalName: string }>,
) {
  if (files.length === 0) return false;
  if (!plainText || plainText === "（附件）") return true;
  if (!plainText.startsWith("附件：")) return false;
  const names = new Set(
    plainText
      .slice("附件：".length)
      .split("、")
      .map((name) => name.trim()),
  );
  return files.every((file) => names.has(file.originalName));
}

function replyText(
  message: Pick<ChatReplyReference, "body" | "attachments">,
) {
  const plainText = htmlToPlainText(message.body);
  const files = message.attachments.filter(
    (attachment) => !attachment.inline,
  );
  // 命中占位时用全部幸存附件的当前标题重建预览：标题修改、部分失败、
  // 单附件撤回都能即时反映
  if (isGeneratedAttachmentPlaceholder(plainText, files)) {
    return truncatePlainText(
      `附件：${files
        .map((file) => file.title?.trim() || file.originalName)
        .join("、")}`,
      120,
    );
  }
  if (plainText && plainText !== "（附件）") {
    return truncatePlainText(plainText, 120);
  }
  return "原消息无文字内容";
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
