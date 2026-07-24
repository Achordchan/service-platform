"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
  const [milestoneDescription, setMilestoneDescription] = useState("");
  const [updateBody, setUpdateBody] = useState("");
  const [updateInternal, setUpdateInternal] = useState(false);
  const [inlineImageUploading, setInlineImageUploading] = useState(false);
  const [stageValue, setStageValue] = useState(project.currentStage ?? "");
  const [showProgress, setShowProgress] = useState(project.showProgress !== false);
  const [showMilestones, setShowMilestones] = useState(
    project.showMilestones !== false,
  );
  const [customerUpdatesEnabled, setCustomerUpdatesEnabled] = useState(
    project.customerUpdatesEnabled !== false,
  );
  const [customerRequestsEnabled, setCustomerRequestsEnabled] = useState(
    project.customerRequestsEnabled !== false,
  );
  const [customerFilesEnabled, setCustomerFilesEnabled] = useState(
    project.customerFilesEnabled !== false,
  );
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
      setMilestoneDescription("");
      setUpdateBody("");
      setUpdateInternal(false);
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

  async function submitMilestone(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await execute<{ deliveryFeedback: DeliveryFeedback }>(
      `/api/v1/projects/${project.id}/milestones`,
      {
        title: String(data.get("title") ?? "").trim(),
        description: hasMeaningfulHtml(milestoneDescription)
          ? milestoneDescription
          : null,
        status: String(data.get("status") ?? "NOT_STARTED"),
        startDate: data.get("startDate")
          ? new Date(String(data.get("startDate"))).toISOString()
          : null,
        endDate: data.get("endDate")
          ? new Date(String(data.get("endDate"))).toISOString()
          : null,
        sortOrder: project.milestones.length,
      },
      "里程碑已创建",
      (result) => result.deliveryFeedback,
    );
  }

  async function submitUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (!hasMeaningfulHtml(updateBody)) {
      toast.warning("请填写进度说明");
      return;
    }
    await execute<{ deliveryFeedback: DeliveryFeedback }>(
      `/api/v1/projects/${project.id}/updates`,
      {
        title: String(data.get("title") ?? "").trim(),
        body: updateBody,
        visibility: updateInternal ? "INTERNAL" : "CUSTOMER_VISIBLE",
      },
      updateInternal ? "内部进度已发布" : "客户进度已发布",
      (result) => result.deliveryFeedback,
    );
  }

  async function submitProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSubmitting(true);
    try {
      await staffApi(
        `/api/v1/projects/${project.id}`,
        jsonRequest("PATCH", {
          title: String(data.get("title") ?? "").trim(),
          description: String(data.get("description") ?? "").trim() || null,
          ...(project.status === "DRAFT"
            ? {}
            : { status: String(data.get("status") ?? project.status) }),
          showMilestones,
          showProgress,
          customerUpdatesEnabled,
          customerRequestsEnabled,
          customerFilesEnabled,
          startDate: data.get("startDate")
            ? new Date(String(data.get("startDate"))).toISOString()
            : null,
          endDate: data.get("endDate")
            ? new Date(String(data.get("endDate"))).toISOString()
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
  }

  async function submitStage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const result = await staffApi<{ deliveryFeedback: DeliveryFeedback }>(
        `/api/v1/projects/${project.id}/stage`,
        jsonRequest("PATCH", { currentStage: stageValue.trim() || null }),
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
  }

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
                  setUpdateBody("");
                  setUpdateInternal(false);
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
                    setMilestoneDescription("");
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
                    setStageValue(project.currentStage ?? "");
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
              setShowProgress(project.showProgress !== false);
              setShowMilestones(project.showMilestones !== false);
              setCustomerUpdatesEnabled(
                project.customerUpdatesEnabled !== false,
              );
              setCustomerRequestsEnabled(
                project.customerRequestsEnabled !== false,
              );
              setCustomerFilesEnabled(project.customerFilesEnabled !== false);
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
              <TextField name="title" label="里程碑名称" required />
              <TextField
                name="status"
                label="状态"
                select
                defaultValue="NOT_STARTED"
              >
                <MenuItem value="NOT_STARTED">未开始</MenuItem>
                <MenuItem value="IN_PROGRESS">进行中</MenuItem>
                <MenuItem value="COMPLETED">已完成</MenuItem>
              </TextField>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  name="startDate"
                  label="开始日期"
                  type="date"
                  fullWidth
                  slotProps={{ inputLabel: { shrink: true } }}
                />
                <TextField
                  name="endDate"
                  label="结束日期"
                  type="date"
                  fullWidth
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              </Stack>
              <Stack spacing={1}>
                <Typography sx={{ fontWeight: 650 }}>说明</Typography>
                <RichTextEditor
                  value={milestoneDescription}
                  onChange={setMilestoneDescription}
                  placeholder="说明里程碑目标、交付内容或验收标准"
                  disabled={submitting}
                  minHeight={130}
                  maxHeight={260}
                  uploadImage={uploadMilestoneImage}
                  onImageUploadingChange={setInlineImageUploading}
                />
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
              <TextField
                label="当前阶段"
                value={stageValue}
                onChange={(event) => setStageValue(event.target.value)}
                placeholder="留空则显示待启动"
                helperText="用于描述交付所处环节，例如需求确认、方案制定、执行实施、测试验收。已付款属于财务信息，不建议填写在这里。"
                slotProps={{ htmlInput: { maxLength: 120 } }}
                autoFocus
                fullWidth
              />
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
              <TextField name="title" label="动态标题" required />
              <Stack spacing={1}>
                <Typography sx={{ fontWeight: 650 }}>进度说明 *</Typography>
                <RichTextEditor
                  value={updateBody}
                  onChange={setUpdateBody}
                  placeholder="说明本次进展、已完成事项和下一步安排"
                  disabled={submitting}
                  minHeight={180}
                  maxHeight={320}
                  uploadImage={uploadInlineImage}
                  onImageUploadingChange={setInlineImageUploading}
                />
              </Stack>
              <FormControlLabel
                control={
                  <Switch
                    checked={updateInternal}
                    onChange={(event) =>
                      setUpdateInternal(event.target.checked)
                    }
                  />
                }
                label="仅内部可见"
              />
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
              <TextField name="title" label="项目名称" defaultValue={project.title} required />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  name="status"
                  label="项目状态"
                  select
                  defaultValue={project.status}
                  fullWidth
                  disabled={project.status === "DRAFT"}
                  helperText={
                    project.status === "DRAFT"
                      ? "完成外部接入并激活后，项目会自动进入进行中"
                      : undefined
                  }
                >
                  {(project.status === "DRAFT"
                    ? [{ value: "DRAFT" as const, label: "待接入" }]
                    : projectStatusOptions
                  ).map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  name="startDate"
                  label="开始日期"
                  type="date"
                  defaultValue={dateInput(project.startDate)}
                  fullWidth
                  slotProps={{ inputLabel: { shrink: true } }}
                />
                <TextField
                  name="endDate"
                  label="结束日期"
                  type="date"
                  defaultValue={dateInput(project.endDate)}
                  fullWidth
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              </Stack>
              <TextField
                name="description"
                label="项目说明"
                defaultValue={project.description ?? ""}
                multiline
                minRows={3}
                slotProps={{ htmlInput: { maxLength: 5000 } }}
              />
              <Stack spacing={0.5}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  客户中心展示
                </Typography>
                <FormControlLabel
                  control={
                    <Switch
                      checked={showProgress}
                      onChange={(event) => setShowProgress(event.target.checked)}
                    />
                  }
                  label="客户显示整体进度条"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={showMilestones}
                      onChange={(event) =>
                        setShowMilestones(event.target.checked)
                      }
                    />
                  }
                  label="客户显示里程碑模块"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={customerUpdatesEnabled}
                      onChange={(event) =>
                        setCustomerUpdatesEnabled(event.target.checked)
                      }
                    />
                  }
                  label="客户显示进度动态"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={customerRequestsEnabled}
                      onChange={(event) =>
                        setCustomerRequestsEnabled(event.target.checked)
                      }
                    />
                  }
                  label="客户显示服务请求"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={customerFilesEnabled}
                      onChange={(event) =>
                        setCustomerFilesEnabled(event.target.checked)
                      }
                    />
                  }
                  label="客户显示文件资料"
                />
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
