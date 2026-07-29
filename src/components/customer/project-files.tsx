"use client";

import Link from "next/link";
import {
  Box,
  IconButton,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import type { ProjectAttachment } from "@/components/customer/customer-types";
import { EmptyState } from "@/components/shared/content-state";
import { ContentRiskStatusLine } from "@/components/shared/content-risk-notice";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function ProjectFiles({
  files,
  contentRiskEnabled = false,
}: {
  files: ProjectAttachment[];
  contentRiskEnabled?: boolean;
}) {
  if (files.length === 0) {
    return (
      <EmptyState
        title="暂无文件资料"
        description="文件上传后将在此显示。"
      />
    );
  }

  return (
    <Paper variant="outlined">
      {files.map((file, index) => (
        <Stack
          key={file.id}
          direction="row"
          spacing={2}
          sx={{
            alignItems: "center",
            px: { xs: 2, md: 2.5 },
            py: 2,
            borderBottom:
              index === files.length - 1 ? 0 : "1px solid",
            borderColor: "divider",
          }}
        >
          <Box
            sx={{
              display: "grid",
              placeItems: "center",
              width: 40,
              height: 40,
              borderRadius: 1.5,
              bgcolor: "action.hover",
              color: "text.secondary",
            }}
          >
            <InsertDriveFileOutlinedIcon />
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            {file.contentRiskStatus === "REVOKED" ? (
              <ContentRiskStatusLine
                status="REVOKED"
                pluginEnabled={contentRiskEnabled}
              />
            ) : (
              <Typography noWrap sx={{ fontWeight: 600 }}>
                {file.originalName}
              </Typography>
            )}
            <Typography variant="body2" color="text.secondary">
              {formatSize(file.size)} ·{" "}
              {dateFormatter.format(new Date(file.createdAt))}
            </Typography>
          </Box>
          {file.contentRiskStatus !== "REVOKED" ? <IconButton
            component={Link}
            href={`/api/v1/attachments/${file.id}`}
            aria-label={`下载 ${file.originalName}`}
          >
            <DownloadOutlinedIcon />
          </IconButton> : null}
        </Stack>
      ))}
    </Paper>
  );
}
