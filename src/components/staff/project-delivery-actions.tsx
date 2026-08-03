"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import CampaignOutlinedIcon from "@mui/icons-material/CampaignOutlined";
import RouteOutlinedIcon from "@mui/icons-material/RouteOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import { DateStringPicker } from "@/components/shared/date-string-picker";
import { RichTextEditor } from "@/components/shared/rich-text-editor";
import { ContentRiskNotice } from "@/components/shared/content-risk-notice";
import { useToast } from "@/components/shared/toast-provider";
import { isProjectDeliveryActive } from "@/components/staff/project-delivery-state";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";
import { hasMeaningfulHtml } from "@/lib/message-content";
import type { DeliveryFeedback } from "@/lib/operation-feedback";
import { useInlineImageUpload } from "@/hooks/use-inline-image-upload";
import type {
  ProjectDetail,
  ProjectStatus,
} from "@/components/staff/staff-types";

type DialogName = "milestone" | "update" | "stage" | "project" | null;

const projectStatusOptions: Array<{ value: ProjectStatus; label: string }> = [
  { value: "ACTIVE", label: "进行中" },
  { value: "PAUSED", label: "已暂停" },
  { value: "COMPLETED", label: "已完成" },
  { value: "EXPIRED", label: "已到期" },
];

function dateInput(value?: string | null) {
  return value ? value.slice(0, 10) : "";
}

const datedFormFields = {
  startDate: z.string(),
  endDate: z.string(),
};
const milestoneFormSchema = z.object({
  title: z.string().trim().min(1, "请填写里程碑名称").max(200),
  description: z.string(),
  status: z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETED"]),
  ...datedFormFields,
}).refine((value) => !value.startDate || !value.endDate || value.endDate >= value.startDate, { path: ["endDate"], message: "结束日期不能早于开始日期" });
const updateFormSchema = z.object({
  title: z.string().trim().min(1, "请填写动态标题").max(200),
  body: z.string().refine(hasMeaningfulHtml, "请填写进度说明"),
  internal: z.boolean(),
});
const stageFormSchema = z.object({ stage: z.string().trim().max(120) });
const projectFormSchema = z.object({
  title: z.string().trim().min(1, "请填写项目名称").max(200),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "EXPIRED"]),
  description: z.string().trim().max(5000),
  showProgress: z.boolean(),
  showMilestones: z.boolean(),
  customerUpdatesEnabled: z.boolean(),
  customerRequestsEnabled: z.boolean(),
  customerFilesEnabled: z.boolean(),
  ...datedFormFields,
}).refine((value) => !value.startDate || !value.endDate || value.endDate >= value.startDate, { path: ["endDate"], message: "结束日期不能早于开始日期" });

type MilestoneFormValues = z.infer<typeof milestoneFormSchema>;
type UpdateFormValues = z.infer<typeof updateFormSchema>;
type StageFormValues = z.infer<typeof stageFormSchema>;
type ProjectFormValues = z.infer<typeof projectFormSchema>;

export function ProjectDeliveryActions({
  project,
  canManageDelivery,
  canPublishUpdate,
  canEditProject,
  contentRiskNoticeEnabled = false,
}: {
  project: ProjectDetail;
  canManageDelivery: boolean;
  canPublishUpdate: boolean;
  canEditProject: boolean;
  contentRiskNoticeEnabled?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [dialog, setDialog] = useState<DialogName>(null);
  const [submitting, setSubmitting] = useState(false);
  const [inlineImageUploading, setInlineImageUploading] = useState(false);
  const milestoneForm = useForm<MilestoneFormValues>({ resolver: zodResolver(milestoneFormSchema), defaultValues: { title: "", description: "", status: "NOT_STARTED", startDate: "", endDate: "" } });
  const updateForm = useForm<UpdateFormValues>({ resolver: zodResolver(updateFormSchema), defaultValues: { title: "", body: "", internal: false } });
  const stageForm = useForm<StageFormValues>({ resolver: zodResolver(stageFormSchema), defaultValues: { stage: project.currentStage ?? "" } });
  const projectForm = useForm<ProjectFormValues>({ resolver: zodResolver(projectFormSchema), defaultValues: {
    title: project.title, status: project.status, description: project.description ?? "", startDate: dateInput(project.startDate), endDate: dateInput(project.endDate),
    showProgress: project.showProgress !== false, showMilestones: project.showMilestones !== false,
    customerUpdatesEnabled: project.customerUpdatesEnabled !== false, customerRequestsEnabled: project.customerRequestsEnabled !== false, customerFilesEnabled: project.customerFilesEnabled !== false,
  } });
  const updateInternal = useWatch({ control: updateForm.control, name: "internal" });
  const updateBody = useWatch({ control: updateForm.control, name: "body" });
  const milestoneStartDate = useWatch({
    control: milestoneForm.control,
    name: "startDate",
  });
  const milestoneEndDate = useWatch({
    control: milestoneForm.control,
    name: "endDate",
  });
  const projectStartDate = useWatch({
    control: projectForm.control,
    name: "startDate",
  });
  const projectEndDate = useWatch({
    control: projectForm.control,
    name: "endDate",
  });
  const uploadInlineImage = useInlineImageUpload({
    projectId: project.id,
    context: "PROJECT_UPDATE",
    visibility: updateInternal ? "INTERNAL" : "CUSTOMER_VISIBLE",
  });
  const uploadMilestoneImage = useInlineImageUpload({
    projectId: project.id,
    context: "MILESTONE",
  });
  const deliveryActive = isProjectDeliveryActive(project.status);

  async function execute<T>(
    url: string,
    body: unknown,
    successMessage: string,
    deliveryFeedback?: (result: T) => DeliveryFeedback | undefined,
  ) {
    setSubmitting(true);
    try {
      const result = await staffApi<T>(url, jsonRequest("POST", body));
      milestoneForm.reset();
      updateForm.reset();
      setInlineImageUploading(false);
      setDialog(null);
      toast.success(successMessage);
      toast.delivery(deliveryFeedback?.(result));
      router.refresh();
    } catch (submitError) {
      toast.error(
        submitError instanceof Error ? submitError.message : "操作失败",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const submitMilestone = milestoneForm.handleSubmit(async (values) => {
    await execute<{ deliveryFeedback: DeliveryFeedback }>(
      `/api/v1/projects/${project.id}/milestones`,
      {
        title: values.title,
        description: hasMeaningfulHtml(values.description)
          ? values.description
          : null,
        status: values.status,
        startDate: values.startDate
          ? new Date(values.startDate).toISOString()
          : null,
        endDate: values.endDate
          ? new Date(values.endDate).toISOString()
          : null,
        sortOrder: project.milestones.length,
      },
      "里程碑已创建",
      (result) => result.deliveryFeedback,
    );
  });

  const submitUpdate = updateForm.handleSubmit(async (values) => {
    await execute<{ deliveryFeedback: DeliveryFeedback }>(
      `/api/v1/projects/${project.id}/updates`,
      {
        title: values.title,
        body: values.body,
        visibility: values.internal ? "INTERNAL" : "CUSTOMER_VISIBLE",
      },
      values.internal ? "内部进度已发布" : "客户进度已发布",
      (result) => result.deliveryFeedback,
    );
  });

  const submitProject = projectForm.handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      await staffApi(
        `/api/v1/projects/${project.id}`,
        jsonRequest("PATCH", {
          title: values.title,
          description: values.description || null,
          ...(project.status === "DRAFT"
            ? {}
            : { status: values.status }),
          showMilestones: values.showMilestones,
          showProgress: values.showProgress,
          customerUpdatesEnabled: values.customerUpdatesEnabled,
          customerRequestsEnabled: values.customerRequestsEnabled,
          customerFilesEnabled: values.customerFilesEnabled,
          startDate: values.startDate
            ? new Date(values.startDate).toISOString()
            : null,
          endDate: values.endDate
            ? new Date(values.endDate).toISOString()
            : null,
        }),
      );
      setDialog(null);
      toast.success("项目设置已保存");
      router.refresh();
    } catch (submitError) {
      toast.error(
        submitError instanceof Error ? submitError.message : "项目更新失败",
      );
    } finally {
      setSubmitting(false);
    }
  });

  const submitStage = stageForm.handleSubmit(async ({ stage }) => {
    setSubmitting(true);
    try {
      const result = await staffApi<{ deliveryFeedback: DeliveryFeedback }>(
        `/api/v1/projects/${project.id}/stage`,
        jsonRequest("PATCH", { currentStage: stage || null }),
      );
      setDialog(null);
      toast.success("项目阶段已更新");
      toast.delivery(result.deliveryFeedback);
      router.refresh();
    } catch (submitError) {
      toast.error(
        submitError instanceof Error ? submitError.message : "阶段更新失败",
      );
    } finally {
      setSubmitting(false);
    }
  });

  if (!canManageDelivery && !canPublishUpdate && !canEditProject) return null;

  return (
    <>
      <Stack
        direction="row"
        spacing={0.75}
        useFlexGap
        sx={{
          flexWrap: { xs: "wrap", md: "nowrap" },
          justifyContent: { xs: "stretch", md: "flex-end" },
          width: "100%",
          "& > *": {
            flex: { xs: "1 1 auto", sm: "0 0 auto" },
            whiteSpace: "nowrap",
          },
        }}
      >
        {deliveryActive ? (
          <>
            {canPublishUpdate ? (
              <Button
                size="small"
                variant="contained"
                startIcon={<CampaignOutlinedIcon />}
                onClick={() => {
                  updateForm.reset({ title: "", body: "", internal: false });
                  setDialog("update");
                }}
              >
                发布进度
              </Button>
            ) : null}
            {canManageDelivery ? (
              <>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<AddOutlinedIcon />}
                  onClick={() => {
                    milestoneForm.reset({ title: "", description: "", status: "NOT_STARTED", startDate: "", endDate: "" });
                    setDialog("milestone");
                  }}
                >
                  新增里程碑
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<RouteOutlinedIcon />}
                  onClick={() => {
                    stageForm.reset({ stage: project.currentStage ?? "" });
                    setDialog("stage");
                  }}
                >
                  更新阶段
                </Button>
              </>
            ) : null}
          </>
        ) : null}
        {canEditProject ? (
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            startIcon={<SettingsOutlinedIcon />}
            onClick={() => {
              projectForm.reset({
                title: project.title,
                status: project.status,
                description: project.description ?? "",
                startDate: dateInput(project.startDate),
                endDate: dateInput(project.endDate),
                showProgress: project.showProgress !== false,
                showMilestones: project.showMilestones !== false,
                customerUpdatesEnabled: project.customerUpdatesEnabled !== false,
                customerRequestsEnabled: project.customerRequestsEnabled !== false,
                customerFilesEnabled: project.customerFilesEnabled !== false,
              });
              setDialog("project");
            }}
          >
            项目设置
          </Button>
        ) : null}
      </Stack>

      <Dialog
        open={dialog === "milestone"}
        onClose={submitting ? undefined : () => setDialog(null)}
        fullWidth
        maxWidth="sm"
        slotProps={{
          paper: { sx: { maxHeight: "calc(100dvh - 48px)" } },
        }}
      >
        <Stack
          component="form"
          onSubmit={submitMilestone}
          sx={{ minHeight: 0, maxHeight: "inherit", overflow: "hidden" }}
        >
          {submitting ? <LinearProgress /> : null}
          <DialogTitle>新增里程碑</DialogTitle>
          <DialogContent sx={{ overflowY: "auto" }}>
            <Stack spacing={2} sx={{ pt: 1 }}>
              {contentRiskNoticeEnabled ? (
                <ContentRiskNotice audience="STAFF" />
              ) : null}
              <Controller name="title" control={milestoneForm.control} render={({ field }) => (
                <TextField {...field} label="里程碑名称" required error={Boolean(milestoneForm.formState.errors.title)} helperText={milestoneForm.formState.errors.title?.message} />
              )} />
              <Controller name="status" control={milestoneForm.control} render={({ field }) => (
                <TextField {...field} label="状态" select>
                  <MenuItem value="NOT_STARTED">未开始</MenuItem>
                  <MenuItem value="IN_PROGRESS">进行中</MenuItem>
                  <MenuItem value="COMPLETED">已完成</MenuItem>
                </TextField>
              )} />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <Controller name="startDate" control={milestoneForm.control} render={({ field }) => (
                  <DateStringPicker
                    label="开始日期"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    name={field.name}
                    inputRef={field.ref}
                    maxDate={milestoneEndDate}
                  />
                )} />
                <Controller name="endDate" control={milestoneForm.control} render={({ field }) => (
                  <DateStringPicker
                    label="结束日期"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    name={field.name}
                    inputRef={field.ref}
                    minDate={milestoneStartDate}
                    error={Boolean(milestoneForm.formState.errors.endDate)}
                    helperText={milestoneForm.formState.errors.endDate?.message}
                  />
                )} />
              </Stack>
              <Stack spacing={1}>
                <Typography sx={{ fontWeight: 650 }}>说明</Typography>
                <Controller name="description" control={milestoneForm.control} render={({ field }) => (
                  <RichTextEditor value={field.value} onChange={field.onChange} placeholder="说明里程碑目标、交付内容或验收标准" disabled={submitting} minHeight={130} maxHeight={260} uploadImage={uploadMilestoneImage} onImageUploadingChange={setInlineImageUploading} />
                )} />
              </Stack>
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 3 }}>
            <Button onClick={() => setDialog(null)} disabled={submitting}>
              取消
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={submitting || inlineImageUploading}
            >
              保存
            </Button>
          </DialogActions>
        </Stack>
      </Dialog>

      <Dialog
        open={dialog === "stage"}
        onClose={submitting ? undefined : () => setDialog(null)}
        fullWidth
        maxWidth="xs"
      >
        <Stack component="form" onSubmit={submitStage}>
          {submitting ? <LinearProgress /> : null}
          <DialogTitle>更新当前阶段</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Controller name="stage" control={stageForm.control} render={({ field }) => (
                <TextField {...field} label="当前阶段" placeholder="留空则显示待启动" helperText={stageForm.formState.errors.stage?.message ?? "用于描述交付所处环节，例如需求确认、方案制定、执行实施、测试验收。已付款属于财务信息，不建议填写在这里。"} error={Boolean(stageForm.formState.errors.stage)} slotProps={{ htmlInput: { maxLength: 120 } }} autoFocus fullWidth />
              )} />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 3 }}>
            <Button onClick={() => setDialog(null)} disabled={submitting}>
              取消
            </Button>
            <Button type="submit" variant="contained" disabled={submitting}>
              保存
            </Button>
          </DialogActions>
        </Stack>
      </Dialog>

      <Dialog
        open={dialog === "update"}
        onClose={submitting ? undefined : () => setDialog(null)}
        fullWidth
        maxWidth="sm"
        slotProps={{
          paper: { sx: { maxHeight: "calc(100dvh - 48px)" } },
        }}
      >
        <Stack
          component="form"
          onSubmit={submitUpdate}
          sx={{ minHeight: 0, maxHeight: "inherit", overflow: "hidden" }}
        >
          {submitting ? <LinearProgress /> : null}
          <DialogTitle>发布项目进度</DialogTitle>
          <DialogContent sx={{ overflowY: "auto" }}>
            <Stack spacing={2} sx={{ pt: 1 }}>
              {contentRiskNoticeEnabled && !updateInternal ? (
                <ContentRiskNotice audience="STAFF" />
              ) : null}
              <Controller name="title" control={updateForm.control} render={({ field }) => (
                <TextField {...field} label="动态标题" required error={Boolean(updateForm.formState.errors.title)} helperText={updateForm.formState.errors.title?.message} />
              )} />
              <Stack spacing={1}>
                <Typography sx={{ fontWeight: 650 }}>进度说明 *</Typography>
                <Controller name="body" control={updateForm.control} render={({ field }) => (
                  <RichTextEditor value={field.value} onChange={field.onChange} placeholder="说明本次进展、已完成事项和下一步安排" disabled={submitting} minHeight={180} maxHeight={320} uploadImage={uploadInlineImage} onImageUploadingChange={setInlineImageUploading} />
                )} />
                {updateForm.formState.errors.body?.message ? <Typography variant="caption" color="error">{updateForm.formState.errors.body.message}</Typography> : null}
              </Stack>
              <Controller name="internal" control={updateForm.control} render={({ field }) => (
                <FormControlLabel control={<Switch checked={field.value} onChange={(_, checked) => field.onChange(checked)} />} label="仅内部可见" />
              )} />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 3 }}>
            <Button onClick={() => setDialog(null)} disabled={submitting}>
              取消
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={
                submitting ||
                inlineImageUploading ||
                !hasMeaningfulHtml(updateBody)
              }
            >
              发布
            </Button>
          </DialogActions>
        </Stack>
      </Dialog>

      <Dialog
        open={dialog === "project"}
        onClose={submitting ? undefined : () => setDialog(null)}
        fullWidth
        maxWidth="sm"
      >
        <Stack component="form" onSubmit={submitProject}>
          {submitting ? <LinearProgress /> : null}
          <DialogTitle>项目设置</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Controller name="title" control={projectForm.control} render={({ field }) => (
                <TextField {...field} label="项目名称" required error={Boolean(projectForm.formState.errors.title)} helperText={projectForm.formState.errors.title?.message} />
              )} />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <Controller name="status" control={projectForm.control} render={({ field }) => (
                  <TextField {...field} label="项目状态" select fullWidth disabled={project.status === "DRAFT"} helperText={project.status === "DRAFT" ? "完成外部接入并激活后，项目会自动进入进行中" : undefined}>
                    {(project.status === "DRAFT" ? [{ value: "DRAFT" as const, label: "待接入" }] : projectStatusOptions).map((option) => (
                      <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                    ))}
                  </TextField>
                )} />
              </Stack>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <Controller name="startDate" control={projectForm.control} render={({ field }) => (
                  <DateStringPicker
                    label="开始日期"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    name={field.name}
                    inputRef={field.ref}
                    maxDate={projectEndDate}
                  />
                )} />
                <Controller name="endDate" control={projectForm.control} render={({ field }) => (
                  <DateStringPicker
                    label="结束日期"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    name={field.name}
                    inputRef={field.ref}
                    minDate={projectStartDate}
                    error={Boolean(projectForm.formState.errors.endDate)}
                    helperText={projectForm.formState.errors.endDate?.message}
                  />
                )} />
              </Stack>
              <Controller name="description" control={projectForm.control} render={({ field }) => (
                <TextField {...field} label="项目说明" multiline minRows={3} error={Boolean(projectForm.formState.errors.description)} helperText={projectForm.formState.errors.description?.message} slotProps={{ htmlInput: { maxLength: 5000 } }} />
              )} />
              <Stack spacing={0.5}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  客户中心展示
                </Typography>
                {([
                  ["showProgress", "客户显示整体进度条"],
                  ["showMilestones", "客户显示里程碑模块"],
                  ["customerUpdatesEnabled", "客户显示进度动态"],
                  ["customerRequestsEnabled", "客户显示服务请求"],
                  ["customerFilesEnabled", "客户显示文件资料"],
                ] as const).map(([name, label]) => (
                  <Controller key={name} name={name} control={projectForm.control} render={({ field }) => (
                    <FormControlLabel control={<Switch checked={field.value} onChange={(_, checked) => field.onChange(checked)} />} label={label} />
                  )} />
                ))}
              </Stack>
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 3 }}>
            <Button onClick={() => setDialog(null)} disabled={submitting}>
              取消
            </Button>
            <Button type="submit" variant="contained" disabled={submitting}>
              保存
            </Button>
          </DialogActions>
        </Stack>
      </Dialog>
    </>
  );
}
