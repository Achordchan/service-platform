"use client";

import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import type { SupportReplyPlaybook } from "@/lib/support-reply-playbooks";
import { resolveInlineAttachmentHtml } from "@/lib/message-content";

export function SupportPlaybookMessageCard({
  playbook,
  inverted = false,
  resolveImageUrl,
}: {
  playbook: SupportReplyPlaybook;
  inverted?: boolean;
  resolveImageUrl?: (attachmentId: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const primaryColor = inverted ? "common.white" : "text.primary";
  const secondaryColor = inverted
    ? "rgba(255,255,255,0.82)"
    : "text.secondary";

  return (
    <>
      <Box sx={{ minWidth: { xs: 0, sm: 240 }, maxWidth: 420 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <MenuBookOutlinedIcon sx={{ fontSize: 19, color: secondaryColor }} />
          <Typography sx={{ fontWeight: 650, color: primaryColor }}>
            {playbook.title}
          </Typography>
        </Stack>
        <Typography
          variant="body2"
          sx={{
            mt: 0.75,
            color: secondaryColor,
            lineHeight: 1.65,
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 2,
            overflow: "hidden",
          }}
        >
          {playbook.summary}
        </Typography>
        <Button
          size="small"
          startIcon={<VisibilityOutlinedIcon />}
          onClick={() => setOpen(true)}
          sx={{
            mt: 1,
            px: 0.5,
            color: inverted ? "common.white" : "primary.main",
          }}
        >
          查看详情
        </Button>
      </Box>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        fullWidth
        maxWidth="sm"
        slotProps={{
          paper: { sx: { maxHeight: "calc(100dvh - 48px)" } },
        }}
      >
        <DialogTitle>{playbook.title}</DialogTitle>
        <DialogContent dividers sx={{ overflowY: "auto" }}>
          <Stack spacing={2.5}>
            {playbook.content ? (
              <Box
                sx={{
                  lineHeight: 1.75,
                  overflowWrap: "anywhere",
                  "& p": { mt: 0, mb: 1 },
                  "& ul, & ol": { my: 1, pl: 2.75 },
                  "& img": {
                    display: "block",
                    maxWidth: "100%",
                    maxHeight: 460,
                    my: 1.5,
                    borderRadius: 1.5,
                    objectFit: "contain",
                  },
                }}
                dangerouslySetInnerHTML={{
                  __html: resolveInlineAttachmentHtml(
                    playbook.content,
                    resolveImageUrl,
                  ),
                }}
              />
            ) : (
              <>
                <Typography sx={{ lineHeight: 1.8 }}>
                  {playbook.introduction}
                </Typography>
                <Box>
                  <Typography variant="h3">操作步骤</Typography>
                  <Box component="ol" sx={{ mt: 1.5, mb: 0, pl: 2.75, "& li": { mb: 1 } }}>
                    {playbook.steps.map((step) => (
                      <li key={step}>
                        <Typography component="span" sx={{ lineHeight: 1.75 }}>{step}</Typography>
                      </li>
                    ))}
                  </Box>
                </Box>
              </>
            )}
            {playbook.safetyNotes.length > 0 ? (
              <Alert severity="warning">
                <Typography variant="subtitle2">安全提示</Typography>
                <Box component="ul" sx={{ mt: 0.75, mb: 0, pl: 2.25 }}>
                  {playbook.safetyNotes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </Box>
              </Alert>
            ) : null}
            <Typography variant="body2" color="text.secondary">
              完成后请回复当前进度；如某一步无法操作，请发送对应页面截图。
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setOpen(false)}>关闭</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
