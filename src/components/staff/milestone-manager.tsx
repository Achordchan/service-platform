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
  IconButton,
  LinearProgress,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import { DateStringPicker } from "@/components/shared/date-string-picker";
import {
  MilestoneList,
  type MilestoneCommentItem,
  type MilestoneListItem,
} from "@/components/shared/milestone-list";
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
import { escapeHtmlText, hasMeaningfulHtml, htmlToPlainText } from "@/lib/message-content";
import { ContentRiskNotice } from "@/components/shared/content-risk-notice";
import type { DeliveryFeedback } from "@/lib/operation-feedback";

/** 纯文本评论转安全 HTML：转义后保留换行，与动态评论一致。 */
function commentTextToHtml(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return `<p>${escapeHtmlText(trimmed).replace(/\n/g, "<br/>")}</p>`;
}

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
  canComment,
  currentUserId,
  contentRiskEnabled = false,
  contentRiskNoticeEnabled = false,
}: {
  projectId: string;
  milestones: ProjectMilestone[];
  canManage: boolean;
  /** 详情弹窗里的评论权限（update.comment 同钥匙） */
  canComment?: boolean;
  currentUserId?: string;
  contentRiskEnabled?: boolean;
  contentRiskNoticeEnabled?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<ProjectMilestone | null>(null);
  // 本次保存的提醒方式覆盖（编辑里程碑同样会发 PROJECT_MILESTONE 通知）
  const [editOverride, setEditOverride] =
    useState<NotificationDeliveryOverride>({});
  // 覆盖是一次性的：取消 / 点遮罩关闭也要归零，否则换一个里程碑再打开时
  // 会带着上次的强制或抑制设置提交
  const closeEditor = () => {
    setEditing(null);
    setEditOverride({});
  };
  const milestoneDeliveryRule = useDeliveryChannelRule("PROJECT_MILESTONE");
  const [deleting, setDeleting] = useState<ProjectMilestone | null>(null);
  const [inlineImageUploading, setInlineImageUploading] = useState(false);
  const [actionId, setActionId] = useState("");
  // 详情弹窗评论区的输入由这里持有：切换里程碑/提交后统一清空
  const [commentText, setCommentText] = useState("");
  const [commentInternal, setCommentInternal] = useState(false);
  const [commentBusy, setCommentBusy] = useState(false);
  const [editComment, setEditComment] = useState<{
    milestone: ProjectMilestone;
    comment: MilestoneCommentItem;
    text: string;
  } | null>(null);
  const [deleteCommentTarget, setDeleteCommentTarget] = useState<{
    milestone: ProjectMilestone;
    comment: MilestoneCommentItem;
  } | null>(null);

  function resetCommentComposer() {
    setCommentText("");
    setCommentInternal(false);
  }

  async function submitComment(milestone: ProjectMilestone) {
    const body = commentTextToHtml(commentText);
    if (!body) {
      toast.warning("请输入评论内容");
      return;
    }
    setCommentBusy(true);
    try {
      await staffApi(
        `/api/v1/projects/${projectId}/milestones/${milestone.id}/comments`,
        jsonRequest("POST", {
          body,
          visibility: commentInternal ? "INTERNAL" : "CUSTOMER_VISIBLE",
        }),
      );
      resetCommentComposer();
      toast.success("评论已发送");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "评论发送失败");
    } finally {
      setCommentBusy(false);
    }
  }

  async function submitEditComment() {
    if (!editComment) return;
    const body = commentTextToHtml(editComment.text);
    if (!body) {
      toast.warning("请输入评论内容");
      return;
    }
    setCommentBusy(true);
    try {
      await staffApi(
        `/api/v1/projects/${projectId}/milestones/${editComment.milestone.id}/comments/${editComment.comment.id}`,
        jsonRequest("PATCH", { body }),
      );
      setEditComment(null);
      toast.success("评论已更新");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "评论更新失败");
    } finally {
      setCommentBusy(false);
    }
  }

  async function confirmDeleteComment() {
    if (!deleteCommentTarget) return;
    setCommentBusy(true);
    try {
      await staffApi(
        `/api/v1/projects/${projectId}/milestones/${deleteCommentTarget.milestone.id}/comments/${deleteCommentTarget.comment.id}`,
        jsonRequest("DELETE"),
      );
      setDeleteCommentTarget(null);
      toast.success("评论已删除");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "评论删除失败");
    } finally {
      setCommentBusy(false);
    }
  }
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
    setEditOverride({});
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
        currentUserId={currentUserId ?? null}
        canComment={canComment}
        composerValue={commentText}
        onComposerChange={setCommentText}
        onDetailChange={() => resetCommentComposer()}
        composerPlaceholder="回复客户或记录说明…"
        composerExtra={
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={commentInternal}
                onChange={(event) => setCommentInternal(event.target.checked)}
                disabled={commentBusy}
              />
            }
            label="仅内部可见"
          />
        }
        commentBusy={commentBusy}
        onSubmitComment={(milestone) => {
          void submitComment(milestone as ProjectMilestone);
        }}
        {...(canComment
          ? {
              onEditComment: (
                milestone: MilestoneListItem,
                comment: MilestoneCommentItem,
              ) =>
                setEditComment({
                  milestone: milestone as ProjectMilestone,
                  comment,
                  // 评论各端都只产出纯文本（转义后包一层 <p>），编辑框里要还原成纯文本
                  text: htmlToPlainText(comment.body),
                }),
            }
          : {})}
        onDeleteComment={(milestone, comment) =>
          setDeleteCommentTarget({
            milestone: milestone as ProjectMilestone,
            comment,
          })
        }
        // 删除与服务端对齐：作者始终能删自己的；持 update.comment
        // 的员工还能删其他人的。编辑则必须同时是作者且仍有评论权限。
        canDeleteComment={(comment) =>
          comment.authorId === currentUserId || Boolean(canComment)
        }
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
        onClose={actionId ? undefined : closeEditor}
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
                onClick={closeEditor}
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

      <Dialog
        open={Boolean(editComment)}
        onClose={commentBusy ? undefined : () => setEditComment(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>编辑评论</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              value={editComment?.text ?? ""}
              onChange={(event) =>
                setEditComment(
                  editComment
                    ? { ...editComment, text: event.target.value }
                    : null,
                )
              }
              fullWidth
              multiline
              minRows={3}
              maxRows={8}
              disabled={commentBusy}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button
            onClick={() => setEditComment(null)}
            disabled={commentBusy}
          >
            取消
          </Button>
          <Button
            variant="contained"
            onClick={() => void submitEditComment()}
            disabled={commentBusy || !editComment?.text.trim()}
          >
            保存
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(deleteCommentTarget)}
        onClose={commentBusy ? undefined : () => setDeleteCommentTarget(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>删除评论</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary">
            删除后评论将不可恢复。
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button
            onClick={() => setDeleteCommentTarget(null)}
            disabled={commentBusy}
          >
            取消
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => void confirmDeleteComment()}
            disabled={commentBusy}
          >
            确认删除
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
