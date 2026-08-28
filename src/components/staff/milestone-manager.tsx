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
  IconButton,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import { DateStringPicker } from "@/components/shared/date-string-picker";
import { MilestoneList } from "@/components/shared/milestone-list";
import { RichTextEditor } from "@/components/shared/rich-text-editor";
import { DeliveryNotice } from "@/components/shared/delivery-notice";
import { useToast } from "@/components/shared/toast-provider";
import { deliveryOverridePayload } from "@/lib/delivery-notice";
import { useDeliveryChannelRule } from "@/hooks/use-delivery-channels";
import type { NotificationDeliveryOverride } from "@/modules/notifications/notification-delivery-override";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";
import type {
  MilestoneStatus,
  ProjectMilestone,
} from "@/components/staff/staff-types";
import { useInlineImageUpload } from "@/hooks/use-inline-image-upload";
import { hasMeaningfulHtml } from "@/lib/message-content";
import { ContentRiskNotice } from "@/components/shared/content-risk-notice";
import type { DeliveryFeedback } from "@/lib/operation-feedback";

function dateInput(value?: string | null) {
  return value ? value.slice(0, 10) : "";
}

const milestoneEditFormSchema = z
  .object({
    title: z.string().trim().min(1, "请填写里程碑名称").max(200),
    description: z.string(),
    status: z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETED"]),
    startDate: z.string(),
    endDate: z.string(),
  })
  .refine(
    (values) =>
      !values.startDate || !values.endDate || values.endDate >= values.startDate,
    { path: ["endDate"], message: "结束日期不能早于开始日期" },
  );

type MilestoneEditFormValues = z.infer<typeof milestoneEditFormSchema>;

export function MilestoneManager({
  projectId,
  milestones,
  canManage,
  contentRiskEnabled = false,
  contentRiskNoticeEnabled = false,
}: {
  projectId: string;
  milestones: ProjectMilestone[];
  canManage: boolean;
  contentRiskEnabled?: boolean;
  contentRiskNoticeEnabled?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<ProjectMilestone | null>(null);
  // 本次保存的提醒方式覆盖（编辑里程碑同样会发 PROJECT_MILESTONE 通知）
  const [editOverride, setEditOverride] =
    useState<NotificationDeliveryOverride>({});
  const milestoneDeliveryRule = useDeliveryChannelRule("PROJECT_MILESTONE");
  const [deleting, setDeleting] = useState<ProjectMilestone | null>(null);
  const [inlineImageUploading, setInlineImageUploading] = useState(false);
  const [actionId, setActionId] = useState("");
  const editForm = useForm<MilestoneEditFormValues>({
    resolver: zodResolver(milestoneEditFormSchema),
    defaultValues: {
      title: "",
      description: "",
      status: "NOT_STARTED",
      startDate: "",
      endDate: "",
    },
  });
  const startDate = useWatch({ control: editForm.control, name: "startDate" });
  const endDate = useWatch({ control: editForm.control, name: "endDate" });
  const uploadImage = useInlineImageUpload({
    projectId,
    context: "MILESTONE",
  });

  async function changeStatus(
    milestone: ProjectMilestone,
    status: MilestoneStatus,
  ) {
    setActionId(milestone.id);
    try {
      const result = await staffApi<{ deliveryFeedback: DeliveryFeedback }>(
        `/api/v1/projects/${projectId}/milestones/${milestone.id}`,
        jsonRequest("PATCH", { status }),
      );
      toast.success("里程碑状态已更新");
      toast.delivery(result.deliveryFeedback);
      router.refresh();
    } catch (updateError) {
      toast.error(
        updateError instanceof Error ? updateError.message : "状态更新失败",
      );
    } finally {
      setActionId("");
    }
  }

  function openEdit(milestone: ProjectMilestone) {
    editForm.reset({
      title: milestone.title,
      description: milestone.description ?? "",
      status: milestone.status,
      startDate: dateInput(milestone.startDate),
      endDate: dateInput(milestone.endDate),
    });
    setInlineImageUploading(false);
    setEditing(milestone);
  }

  function openDelete(milestone: ProjectMilestone) {
    setDeleting(milestone);
  }

  const submitEdit = editForm.handleSubmit(async (values) => {
    if (!editing) return;
    setActionId(editing.id);
    try {
      const result = await staffApi<{ deliveryFeedback: DeliveryFeedback }>(
        `/api/v1/projects/${projectId}/milestones/${editing.id}`,
        jsonRequest("PATCH", {
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
          ...deliveryOverridePayload(editOverride, milestoneDeliveryRule),
        }),
      );
      setEditing(null);
      // 覆盖是一次性的，不跨下一次编辑沿用
      setEditOverride({});
      toast.success("里程碑已更新");
      toast.delivery(result.deliveryFeedback);
      router.refresh();
    } catch (updateError) {
      toast.error(
        updateError instanceof Error ? updateError.message : "里程碑更新失败",
      );
    } finally {
      setActionId("");
    }
  });

  async function confirmDelete() {
    if (!deleting) return;
    setActionId(deleting.id);
    try {
      await staffApi(
        `/api/v1/projects/${projectId}/milestones/${deleting.id}`,
        jsonRequest("DELETE"),
      );
      setDeleting(null);
      toast.success("里程碑已删除");
      router.refresh();
    } catch (deleteError) {
      toast.error(
        deleteError instanceof Error ? deleteError.message : "里程碑删除失败",
      );
    } finally {
      setActionId("");
    }
  }

  return (
    <Stack spacing={2}>
      <MilestoneList
        milestones={milestones}
        contentRiskEnabled={contentRiskEnabled}
        renderActions={
          canManage
            ? (milestone) => (
                <Stack
                  direction="row"
                  spacing={0.75}
                  sx={{
                    width: { xs: "100%", md: "auto" },
                    alignItems: "center",
                    justifyContent: { xs: "space-between", md: "flex-end" },
                    flexShrink: 0,
                  }}
                >
                  <TextField
                    select
                    size="small"
                    label="里程碑状态"
                    value={milestone.status}
                    onChange={(event) =>
                      void changeStatus(
                        milestone as ProjectMilestone,
                        event.target.value as MilestoneStatus,
                      )
                    }
                    disabled={actionId === milestone.id}
                    sx={{ width: { xs: "100%", sm: 170 } }}
                  >
                    <MenuItem value="NOT_STARTED">未开始</MenuItem>
                    <MenuItem value="IN_PROGRESS">进行中</MenuItem>
                    <MenuItem value="COMPLETED">已完成</MenuItem>
                  </TextField>
                  <Stack direction="row" spacing={0.25} sx={{ flexShrink: 0 }}>
                    <Tooltip title="编辑里程碑">
                      <span>
                        <IconButton
                          size="small"
                          onClick={() => openEdit(milestone as ProjectMilestone)}
                          disabled={actionId === milestone.id}
                          aria-label={`编辑里程碑 ${milestone.title}`}
                        >
                          <EditOutlinedIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="删除里程碑">
                      <span>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() =>
                            openDelete(milestone as ProjectMilestone)
                          }
                          disabled={actionId === milestone.id}
                          aria-label={`删除里程碑 ${milestone.title}`}
                        >
                          <DeleteOutlineOutlinedIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                </Stack>
              )
            : undefined
        }
      />

      <Dialog
        open={Boolean(editing)}
        onClose={actionId ? undefined : () => setEditing(null)}
        fullWidth
        maxWidth="sm"
        slotProps={{
          paper: { sx: { maxHeight: "calc(100dvh - 48px)" } },
        }}
      >
        {editing ? (
          <Stack
            component="form"
            onSubmit={submitEdit}
            sx={{ minHeight: 0, maxHeight: "inherit", overflow: "hidden" }}
          >
            {actionId === editing.id ? <LinearProgress /> : null}
            <DialogTitle>编辑里程碑</DialogTitle>
            <DialogContent sx={{ overflowY: "auto" }}>
              <Stack spacing={2} sx={{ pt: 1 }}>
                {contentRiskNoticeEnabled ? (
                  <ContentRiskNotice audience="STAFF" />
                ) : null}
                <Controller
                  name="title"
                  control={editForm.control}
                  render={({ field }) => (
                    <TextField {...field} label="里程碑名称" required error={Boolean(editForm.formState.errors.title)} helperText={editForm.formState.errors.title?.message} slotProps={{ htmlInput: { maxLength: 200 } }} />
                  )}
                />
                <Controller
                  name="status"
                  control={editForm.control}
                  render={({ field }) => (
                    <TextField {...field} label="状态" select>
                      <MenuItem value="NOT_STARTED">未开始</MenuItem>
                      <MenuItem value="IN_PROGRESS">进行中</MenuItem>
                      <MenuItem value="COMPLETED">已完成</MenuItem>
                    </TextField>
                  )}
                />
                <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                  <Controller
                    name="startDate"
                    control={editForm.control}
                    render={({ field }) => (
                      <DateStringPicker
                        label="开始日期"
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        name={field.name}
                        inputRef={field.ref}
                        maxDate={endDate}
                      />
                    )}
                  />
                  <Controller
                    name="endDate"
                    control={editForm.control}
                    render={({ field }) => (
                      <DateStringPicker
                        label="结束日期"
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        name={field.name}
                        inputRef={field.ref}
                        minDate={startDate}
                        error={Boolean(editForm.formState.errors.endDate)}
                        helperText={editForm.formState.errors.endDate?.message}
                      />
                    )}
                  />
                </Stack>
                <Stack spacing={1}>
                  <Typography sx={{ fontWeight: 650 }}>说明</Typography>
                  <Controller
                    name="description"
                    control={editForm.control}
                    render={({ field }) => (
                      <RichTextEditor
                        key={editing.id}
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="说明里程碑目标、交付内容或验收标准"
                        disabled={actionId === editing.id}
                        minHeight={150}
                        maxHeight={300}
                        uploadImage={uploadImage}
                        onImageUploadingChange={setInlineImageUploading}
                      />
                    )}
                  />
                </Stack>
                <DeliveryNotice
                  scene={{ scene: "PROJECT_MILESTONE", projectId }}
                  override={editOverride}
                  onOverrideChange={setEditOverride}
                  disabled={actionId === editing.id}
                />
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 3 }}>
              <Button
                onClick={() => setEditing(null)}
                disabled={actionId === editing.id}
              >
                取消
              </Button>
              <Button
                type="submit"
                variant="contained"
                disabled={actionId === editing.id || inlineImageUploading}
              >
                保存
              </Button>
            </DialogActions>
          </Stack>
        ) : null}
      </Dialog>

      <Dialog
        open={Boolean(deleting)}
        onClose={actionId ? undefined : () => setDeleting(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>删除里程碑</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Typography color="text.secondary">
              删除“{deleting?.title}”后，其正文图片也会一并删除。此操作无法撤销。
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setDeleting(null)} disabled={Boolean(actionId)}>
            取消
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => void confirmDelete()}
            disabled={Boolean(actionId)}
          >
            确认删除
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
