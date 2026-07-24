"use client";

import { useState } from "react";
import { useAttachmentPolicy } from "@/hooks/use-attachment-policy";
import { useRouter } from "next/navigation";
import {
  Button,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import FileUploadOutlinedIcon from "@mui/icons-material/FileUploadOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { useToast } from "@/components/shared/toast-provider";
import {
  ContentRiskNotice,
  ContentRiskStatusLine,
} from "@/components/shared/content-risk-notice";
import type {
  ContentVisibility,
  RequestAttachment,
} from "@/components/staff/staff-types";
import type { DeliveryFeedback } from "@/lib/operation-feedback";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function ProjectFileManager({
  projectId,
  files,
  canUpload,
  contentRiskEnabled = false,
  contentRiskNoticeEnabled = false,
}: {
  projectId: string;
  files: RequestAttachment[];
  canUpload: boolean;
  contentRiskEnabled?: boolean;
  contentRiskNoticeEnabled?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const { policy } = useAttachmentPolicy();
  const [visibility, setVisibility] =
    useState<ContentVisibility>("CUSTOMER_VISIBLE");
  const [uploading, setUploading] = useState(false);

  async function upload(file: File) {
    setUploading(true);
    const body = new FormData();
    body.append("file", file);
    body.append("projectId", projectId);
    body.append("visibility", visibility);
    const response = await fetch("/api/v1/attachments", {
      method: "POST",
      body,
    });
    if (!response.ok) {
      const result = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      toast.error(result.error?.message ?? "文件上传失败");
    } else {
      const result = (await response.json()) as {
        data?: { deliveryFeedback?: DeliveryFeedback | null };
      };
      toast.success(
        visibility === "CUSTOMER_VISIBLE"
          ? "文件已上传，客户可在项目中查看"
          : "内部文件已上传",
      );
      toast.delivery(result.data?.deliveryFeedback);
      router.refresh();
    }
    setUploading(false);
  }

  return (
    <Stack spacing={2}>
      {canUpload ? (
        <Paper variant="outlined" sx={{ p: 2 }}>
          {contentRiskNoticeEnabled && visibility === "CUSTOMER_VISIBLE" ? (
            <ContentRiskNotice audience="STAFF" />
          ) : null}
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1.5}
            sx={{ alignItems: { sm: "center" } }}
          >
            <TextField
              select
              label="可见范围"
              value={visibility}
              onChange={(event) =>
                setVisibility(event.target.value as ContentVisibility)
              }
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="CUSTOMER_VISIBLE">客户可见</MenuItem>
              <MenuItem value="INTERNAL">仅内部可见</MenuItem>
            </TextField>
            <Button
              component="label"
              variant="contained"
              startIcon={<FileUploadOutlinedIcon />}
              disabled={uploading}
            >
              {uploading ? "正在上传" : "上传文件"}
              <input
                hidden
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                  event.target.value = "";
                }}
              />
            </Button>
            <Typography variant="body2" color="text.secondary">
              单个文件不超过 {policy.maxSizeMb}MB
            </Typography>
          </Stack>
        </Paper>
      ) : null}
      <Paper variant="outlined">
        {files.map((file, index) => (
          <Stack
            key={file.id}
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            sx={{
              px: 2.5,
              py: 2,
              borderBottom:
                index === files.length - 1 ? 0 : "1px solid",
              borderColor: "divider",
              alignItems: { sm: "center" },
              justifyContent: "space-between",
            }}
          >
            <div>
              {file.contentRiskStatus === "REVOKED" ? (
                <ContentRiskStatusLine
                  status="REVOKED"
                  pluginEnabled={contentRiskEnabled}
                />
              ) : (
                <>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Typography sx={{ fontWeight: 650 }}>
                  {file.originalName}
                </Typography>
                {file.visibility === "INTERNAL" ? (
                  <LockOutlinedIcon fontSize="small" color="action" />
                ) : null}
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {dateFormatter.format(new Date(file.createdAt))}
              </Typography>
                </>
              )}
            </div>
            {file.contentRiskStatus !== "REVOKED" ? <Button
              component="a"
              href={`/api/v1/attachments/${file.id}`}
              variant="outlined"
            >
              下载
            </Button> : null}
          </Stack>
        ))}
        {files.length === 0 ? (
          <Typography
            color="text.secondary"
            sx={{ px: 2.5, py: 5, textAlign: "center" }}
          >
            暂无项目文件
          </Typography>
        ) : null}
      </Paper>
    </Stack>
  );
}
