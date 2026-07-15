"use client";

import CloseOutlinedIcon from "@mui/icons-material/CloseOutlined";
import { Box, IconButton, Stack, Typography } from "@mui/material";
import type {
  ChatReplyReference,
  ChatReplyTarget,
} from "@/components/shared/request-chat-types";
import { htmlToPlainText, truncatePlainText } from "@/lib/message-content";

function replyText(
  message: Pick<ChatReplyReference, "body" | "attachments">,
) {
  const plainText = htmlToPlainText(message.body);
  if (plainText && plainText !== "（附件）") {
    return truncatePlainText(plainText, 120);
  }
  const fileName = message.attachments[0]?.originalName;
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
    <Stack
      direction="row"
      spacing={1}
      sx={{
        alignItems: "center",
        borderLeft: "3px solid",
        borderColor: "primary.main",
        bgcolor: "#f8fafc",
        borderRadius: 1.5,
        px: 1.25,
        py: 1,
      }}
    >
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="caption" sx={{ fontWeight: 700 }}>
          回复 {target.authorName}
        </Typography>
        <Typography
          variant="body2"
          color="text.secondary"
          noWrap
          sx={{ mt: 0.25 }}
        >
          {replyText(target)}
        </Typography>
      </Box>
      <IconButton
        size="small"
        onClick={onCancel}
        aria-label="取消回复"
      >
        <CloseOutlinedIcon fontSize="small" />
      </IconButton>
    </Stack>
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
        minWidth: 0,
      }}
    >
      <Typography
        variant="caption"
        sx={{
          display: "block",
          fontWeight: 700,
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
