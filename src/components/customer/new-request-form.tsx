"use client";

import { useMemo, useState } from "react";
import { useAttachmentPolicy } from "@/hooks/use-attachment-policy";
import { useInlineImageUpload } from "@/hooks/use-inline-image-upload";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import {
  Alert,
  Box,
  Button,
  FormControl,
  FormHelperText,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AttachFileOutlinedIcon from "@mui/icons-material/AttachFileOutlined";
import { RequestAttachmentDrafts } from "@/components/shared/request-chat-attachments";
import { RichTextEditor } from "@/components/shared/rich-text-editor";
import { hasMeaningfulHtml } from "@/lib/message-content";
import type {
  RequestPriority,
  RequestProjectOption,
} from "@/components/customer/customer-types";

type FormValues = {
  projectId: string;
  categoryId: string;
  title: string;
  description: string;
  priority: RequestPriority;
};

type ApiError = {
  error?: {
    message?: string;
  };
};

export function NewRequestForm({
  projects,
  initialProjectId,
}: {
  projects: RequestProjectOption[];
  initialProjectId?: string;
}) {
  const router = useRouter();
  const { policy, validateFiles } = useAttachmentPolicy();
  const [files, setFiles] = useState<File[]>([]);
  const [submitError, setSubmitError] = useState("");
  const [submitProgress, setSubmitProgress] = useState("");
  const [inlineImageUploading, setInlineImageUploading] = useState(false);
  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      projectId:
        projects.find((project) => project.id === initialProjectId)?.id ??
        projects[0]?.id ??
        "",
      categoryId: "",
      title: "",
      description: "<p></p>",
      priority: "NORMAL",
    },
  });

  const selectedProjectId = useWatch({ control, name: "projectId" });
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId),
    [projects, selectedProjectId],
  );
  const uploadInlineImage = useInlineImageUpload({
    projectId: selectedProjectId,
    context: "REQUEST_DESCRIPTION",
  });

  function addFiles(nextFiles: File[]) {
    const { accepted, error } = validateFiles(nextFiles, files.length);
    if (error) setSubmitError(error);
    if (accepted.length > 0) {
      if (!error) setSubmitError("");
      setFiles((current) => [...current, ...accepted]);
    }
  }

  async function onSubmit(values: FormValues) {
    setSubmitError("");
    setSubmitProgress("正在创建服务请求");

    try {
      const response = await fetch(
        `/api/v1/projects/${values.projectId}/requests`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            categoryId: values.categoryId,
            title: values.title,
            description: values.description,
            priority: values.priority,
          }),
        },
      );
      const payload = (await response.json()) as
        | { data: { id: string; initialMessageId: string } }
        | ApiError;
      if (!response.ok || !("data" in payload)) {
        throw new Error(
          "error" in payload
            ? payload.error?.message || "服务请求创建失败"
            : "服务请求创建失败",
        );
      }

      const requestId = payload.data.id;
      const initialMessageId = payload.data.initialMessageId;
      if (files.length > 0) {
        setSubmitProgress(`正在上传附件（共 ${files.length} 个）`);
        for (const file of files) {
          const formData = new FormData();
          formData.append("file", file);
          formData.append("serviceRequestId", requestId);
          formData.append("requestMessageId", initialMessageId);
          formData.append("visibility", "CUSTOMER_VISIBLE");
          const uploadResponse = await fetch("/api/v1/attachments", {
            method: "POST",
            body: formData,
          });
          if (!uploadResponse.ok) {
            const uploadPayload = (await uploadResponse.json()) as ApiError;
            throw new Error(
              uploadPayload.error?.message ||
                `${file.name} 上传失败，请进入服务请求后重新上传`,
            );
          }
        }
      }

      router.push(`/customer/requests/${requestId}?created=1`);
      router.refresh();
    } catch (error) {
      setSubmitProgress("");
      setSubmitError(
        error instanceof Error ? error.message : "提交失败，请稍后重试",
      );
    }
  }

  if (projects.length === 0) {
    return (
      <Alert severity="info">
        当前没有可提交服务请求的项目，请等待服务项目启用后再提交。
      </Alert>
    );
  }

  return (
    <Paper
      component="form"
      variant="outlined"
      onSubmit={handleSubmit(onSubmit)}
      sx={{ overflow: "hidden" }}
    >
      {isSubmitting ? <LinearProgress /> : null}
      <Stack spacing={3} sx={{ p: { xs: 2.5, md: 4 } }}>
        {submitError ? <Alert severity="error">{submitError}</Alert> : null}
        {submitProgress ? (
          <Alert severity="info">{submitProgress}</Alert>
        ) : null}

        <Stack direction={{ xs: "column", md: "row" }} spacing={2.5}>
          <Controller
            name="projectId"
            control={control}
            rules={{ required: "请选择所属项目" }}
            render={({ field }) => (
              <FormControl fullWidth error={Boolean(errors.projectId)}>
                <InputLabel>所属项目</InputLabel>
                <Select
                  {...field}
                  label="所属项目"
                  onChange={(event) => {
                    field.onChange(event);
                    setValue("categoryId", "");
                  }}
                >
                  {projects.map((project) => (
                    <MenuItem key={project.id} value={project.id}>
                      {project.title} · {project.serviceTypeName}
                    </MenuItem>
                  ))}
                </Select>
                <FormHelperText>{errors.projectId?.message}</FormHelperText>
              </FormControl>
            )}
          />
          <Controller
            name="categoryId"
            control={control}
            rules={{ required: "请选择业务类型" }}
            render={({ field }) => (
              <FormControl
                fullWidth
                error={Boolean(errors.categoryId)}
                disabled={!selectedProject?.categories.length}
              >
                <InputLabel>业务类型</InputLabel>
                <Select {...field} label="业务类型">
                  {selectedProject?.categories.map((category) => (
                    <MenuItem key={category.id} value={category.id}>
                      {category.name}
                    </MenuItem>
                  ))}
                </Select>
                <FormHelperText>
                  {errors.categoryId?.message ||
                    (!selectedProject?.categories.length
                      ? "当前服务暂无可用请求分类"
                      : "请选择最接近的问题类型")}
                </FormHelperText>
              </FormControl>
            )}
          />
        </Stack>

        <Controller
          name="title"
          control={control}
          rules={{
            required: "请输入问题标题",
            maxLength: { value: 160, message: "标题不能超过 160 个字符" },
          }}
          render={({ field }) => (
            <TextField
              {...field}
              label="问题标题"
              placeholder="用一句话描述需要处理的问题"
              error={Boolean(errors.title)}
              helperText={errors.title?.message}
              fullWidth
            />
          )}
        />

        <Controller
          name="description"
          control={control}
          rules={{
            validate: (value) =>
              hasMeaningfulHtml(value) || "请补充问题详情",
          }}
          render={({ field }) => (
            <Box>
              <Typography sx={{ mb: 1, fontWeight: 650 }}>问题详情</Typography>
              <RichTextEditor
                value={field.value}
                onChange={field.onChange}
                disabled={isSubmitting}
                uploadImage={uploadInlineImage}
                onImageUploadingChange={setInlineImageUploading}
                minHeight={180}
                placeholder="请说明现象、影响范围、期望结果，以及已尝试的处理方式"
              />
              {errors.description?.message ? (
                <FormHelperText error sx={{ mx: 0, mt: 0.75 }}>
                  {errors.description.message}
                </FormHelperText>
              ) : null}
            </Box>
          )}
        />

        <Controller
          name="priority"
          control={control}
          render={({ field }) => (
            <FormControl sx={{ width: { xs: "100%", md: 260 } }}>
              <InputLabel>优先级</InputLabel>
              <Select {...field} label="优先级">
                <MenuItem value="LOW">低</MenuItem>
                <MenuItem value="NORMAL">普通</MenuItem>
                <MenuItem value="HIGH">高</MenuItem>
                <MenuItem value="URGENT">紧急</MenuItem>
              </Select>
              <FormHelperText>
                紧急仅用于业务中断或大范围不可用
              </FormHelperText>
            </FormControl>
          )}
        />

        <Box>
          <Button
            component="label"
            variant="outlined"
            startIcon={<AttachFileOutlinedIcon />}
            disabled={isSubmitting}
          >
            添加附件
            <input
              hidden
              multiple
              type="file"
              accept={policy.accept}
              onChange={(event) => {
                addFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
          </Button>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            最多 5 个附件，单文件不超过 {policy.maxSizeMb}MB；支持粘贴图片；格式：
            {policy.allowedExtensions.join("、")}
          </Typography>
          <Box sx={{ mt: files.length > 0 ? 1.5 : 0 }}>
            <RequestAttachmentDrafts
              files={files}
              onRemove={(index) =>
                setFiles((current) =>
                  current.filter((_, fileIndex) => fileIndex !== index),
                )
              }
            />
          </Box>
        </Box>

        <Stack
          direction={{ xs: "column-reverse", sm: "row" }}
          spacing={1.5}
          sx={{ pt: 1, justifyContent: "flex-end" }}
        >
          <Button
            type="button"
            color="inherit"
            onClick={() => router.back()}
            disabled={isSubmitting}
          >
            取消
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={
              isSubmitting ||
              inlineImageUploading ||
              !selectedProject?.categories.length
            }
          >
            {isSubmitting ? "正在提交" : "提交服务请求"}
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
