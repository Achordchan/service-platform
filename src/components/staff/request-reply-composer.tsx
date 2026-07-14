"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Button,
  FormControlLabel,
  LinearProgress,
  Paper,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import AttachFileOutlinedIcon from "@mui/icons-material/AttachFileOutlined";
import SendOutlinedIcon from "@mui/icons-material/SendOutlined";
import { RichTextEditor } from "@/components/shared/rich-text-editor";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";
import { useAttachmentPolicy } from "@/hooks/use-attachment-policy";
import { markRequestLocalMutation } from "@/hooks/use-request-realtime";
import { hasMeaningfulHtml } from "@/lib/message-content";

export function RequestReplyComposer({ requestId }: { requestId: string }) {
  const router = useRouter();
  const { policy, validateFiles, filesFromClipboard } = useAttachmentPolicy();
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function addFiles(next: File[]) {
    const { accepted, error: validateError } = validateFiles(next, files.length);
    if (validateError) setError(validateError);
    if (accepted.length > 0) {
      if (!validateError) setError("");
      setFiles((current) => [...current, ...accepted]);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasMeaningfulHtml(body) && files.length === 0) return;
    setSubmitting(true);
    setError("");
    try {
      const result = await staffApi<{ message: { id: string } }>(
        `/api/v1/requests/${requestId}/messages`,
        jsonRequest("POST", {
          body: hasMeaningfulHtml(body) ? body : "<p>（附件）</p>",
          visibility: internal ? "INTERNAL" : "CUSTOMER_VISIBLE",
        }),
      );
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("serviceRequestId", requestId);
        formData.append("requestMessageId", result.message.id);
        formData.append(
          "visibility",
          internal ? "INTERNAL" : "CUSTOMER_VISIBLE",
        );
        await staffApi("/api/v1/attachments", {
          method: "POST",
          body: formData,
        });
      }
      setBody("");
      setFiles([]);
      setInternal(false);
      markRequestLocalMutation();
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "回复发送失败",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Paper
      component="form"
      variant="outlined"
      onSubmit={submit}
      onPaste={(event) => {
        const imageFiles = filesFromClipboard(event.clipboardData);
        if (imageFiles.length > 0) {
          event.preventDefault();
          addFiles(imageFiles);
        }
      }}
      sx={{ overflow: "hidden" }}
    >
      {submitting ? <LinearProgress /> : null}
      <Stack spacing={1.5} sx={{ p: { xs: 2, md: 2.5 } }}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{ justifyContent: "space-between" }}
        >
          <Typography sx={{ fontWeight: 650 }}>
            {internal ? "添加内部备注" : "回复客户"}
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={internal}
                onChange={(event) => setInternal(event.target.checked)}
              />
            }
            label="仅内部可见"
          />
        </Stack>
        {internal ? (
          <Alert severity="warning">内部备注不会发送给客户。</Alert>
        ) : null}
        <RichTextEditor
          value={body}
          onChange={setBody}
          disabled={submitting}
          placeholder={internal ? "记录内部处理信息" : "输入给客户的回复"}
        />
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          sx={{ justifyContent: "space-between" }}
        >
          <Button
            component="label"
            startIcon={<AttachFileOutlinedIcon />}
            disabled={submitting}
          >
            添加附件
            <input
              hidden
              type="file"
              multiple
              accept={policy.accept}
              onChange={(event) => {
                addFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
          </Button>
          <Button
            type="submit"
            variant="contained"
            endIcon={<SendOutlinedIcon />}
            disabled={
              submitting ||
              (!hasMeaningfulHtml(body) && files.length === 0)
            }
          >
            {internal ? "保存备注" : "发送回复"}
          </Button>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          支持粘贴图片；单文件不超过 {policy.maxSizeMb}MB；格式：
          {policy.allowedExtensions.join("、")}
        </Typography>
        {files.length > 0 ? (
          <Stack spacing={0.75}>
            {files.map((file, index) => (
              <Stack
                key={`${file.name}-${file.lastModified}-${index}`}
                direction="row"
                spacing={1}
                sx={{ justifyContent: "space-between", alignItems: "center" }}
              >
                <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
                  {file.name}
                </Typography>
                <Button
                  size="small"
                  color="inherit"
                  onClick={() =>
                    setFiles((current) =>
                      current.filter((_, fileIndex) => fileIndex !== index),
                    )
                  }
                >
                  移除
                </Button>
              </Stack>
            ))}
          </Stack>
        ) : null}
      </Stack>
    </Paper>
  );
}
