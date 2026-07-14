"use client";

import Link from "next/link";
import { Box, IconButton, Stack, Typography } from "@mui/material";
import AttachFileOutlinedIcon from "@mui/icons-material/AttachFileOutlined";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import type { RequestAttachment } from "@/components/staff/staff-types";

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function RequestAttachmentList({
  files,
}: {
  files: RequestAttachment[];
}) {
  if (files.length === 0) return null;
  return (
    <Stack spacing={1} sx={{ mt: 1.5 }}>
      {files.map((file) => (
        <Stack
          key={file.id}
          direction="row"
          spacing={1.25}
          sx={{
            alignItems: "center",
            p: 1.25,
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1.5,
            bgcolor: file.visibility === "INTERNAL" ? "#fffbeb" : "#f8fafc",
          }}
        >
          <AttachFileOutlinedIcon fontSize="small" color="action" />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
              {file.originalName}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {formatSize(file.size)}
              {file.visibility === "INTERNAL" ? " · 内部附件" : ""}
            </Typography>
          </Box>
          <IconButton
            component={Link}
            href={`/api/v1/attachments/${file.id}`}
            aria-label={`下载 ${file.originalName}`}
            size="small"
          >
            <DownloadOutlinedIcon fontSize="small" />
          </IconButton>
        </Stack>
      ))}
    </Stack>
  );
}
