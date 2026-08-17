"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import UpdateOutlinedIcon from "@mui/icons-material/UpdateOutlined";
import { CollapsibleText } from "@/components/shared/collapsible-text";
import { EmptyState } from "@/components/shared/content-state";
import { RichTextEditor } from "@/components/shared/rich-text-editor";
import { useToast } from "@/components/shared/toast-provider";
import { useInlineImageUpload } from "@/hooks/use-inline-image-upload";
import { hasMeaningfulHtml } from "@/lib/message-content";
import { ProjectStaffManager } from "@/components/staff/project-staff-manager";
import { ProjectFileManager } from "@/components/staff/project-file-manager";
import { isProjectDeliveryActive } from "@/components/staff/project-delivery-state";
import { MilestoneManager } from "@/components/staff/milestone-manager";
import { TabBadgeLabel } from "@/components/shared/tab-badge-label";
import {
  ContentRiskNotice,
  ContentRiskStatusLine,
} from "@/components/shared/content-risk-notice";
import {
  countProjectRequestUnread,
  countProjectScopeUnread,
  countProjectUpdateUnread,
  useMarkNotificationsRead,
  useUnreadNotifications,
} from "@/hooks/use-unread-notifications";
import { RequestTable } from "@/components/staff/request-table";
import {
  ExternalContactsPanel,
  Sub2ApiIntegrationPanel,
} from "@/components/staff/sub2api-integration-panel";
import { UniversalIntegrationPanel } from "@/components/staff/universal-integration-panel";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";
import {
  UpdateHistoryDialog,
  type UpdateHistoryTarget,
} from "@/components/staff/update-history-dialog";
import type {
  ProjectDetail,
  ProjectUpdate,
  RequestListItem,
  StaffCandidate,
} from "@/components/staff/staff-types";

type ProjectTab =
  | "overview"
  | "milestones"
  | "updates"
  | "requests"
  | "files"
  | "integration"
  | "contacts";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function formatDate(value?: string | null) {
  return value ? dateFormatter.format(new Date(value)) : "未设置";
}

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function EditedAtLabel({
  updatedAt,
  onClick,
}: {
  updatedAt: string;
  onClick: () => void;
}) {
  return (
    <>
      {" · "}
      <Box
        component="button"
        type="button"
        onClick={onClick}
        sx={{
          border: 0,
          background: "none",
          p: 0,
          font: "inherit",
          color: "primary.main",
          cursor: "pointer",
          textDecoration: "underline",
        }}
      >
        重新编辑于 {dateTimeFormatter.format(new Date(updatedAt))}
      </Box>
    </>
  );
}

const updateEditFormSchema = z.object({
  title: z.string().trim().min(1, "请填写动态标题").max(200),
  body: z.string().refine(hasMeaningfulHtml, "请填写进度说明"),
  internal: z.boolean(),
});
type UpdateEditFormValues = z.infer<typeof updateEditFormSchema>;

const commentEditFormSchema = z.object({
  body: z.string().trim().min(1, "请填写评论内容").max(10000),
  internal: z.boolean(),
});
type CommentEditFormValues = z.infer<typeof commentEditFormSchema>;

type CommentItem = ProjectUpdate["comments"][number];

function SummaryField({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <Box>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Box sx={{ mt: 0.75 }}>{value}</Box>
    </Box>
  );
}

export function ProjectDetailWorkspace({
  project,
  requests,
  currentUserId,
  canManageDelivery,
  canPublishUpdate,
  canManageStaff,
  canUploadFiles,
  canEditProject,
  staffCandidates,
  contentRiskNoticeEnabled = false,
}: {
  project: ProjectDetail;
  requests: RequestListItem[];
  currentUserId: string;
  canManageDelivery: boolean;
  canPublishUpdate: boolean;
  canManageStaff: boolean;
  canUploadFiles: boolean;
  canEditProject: boolean;
  staffCandidates: StaffCandidate[];
  contentRiskNoticeEnabled?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<ProjectTab>("overview");
  const [deleteTarget, setDeleteTarget] = useState<ProjectUpdate | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<UpdateHistoryTarget | null>(
    null,
  );
  const [editUpdateTarget, setEditUpdateTarget] =
    useState<ProjectUpdate | null>(null);
  const [editCommentTarget, setEditCommentTarget] = useState<{
    update: ProjectUpdate;
    comment: CommentItem;
  } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [inlineImageUploading, setInlineImageUploading] = useState(false);

  const updateEditForm = useForm<UpdateEditFormValues>({
    resolver: zodResolver(updateEditFormSchema),
    defaultValues: { title: "", body: "", internal: false },
  });
  const updateEditInternal = useWatch({
    control: updateEditForm.control,
    name: "internal",
  });
  const updateEditBody = useWatch({
    control: updateEditForm.control,
    name: "body",
  });
  const uploadInlineImage = useInlineImageUpload({
    projectId: project.id,
    context: "PROJECT_UPDATE",
    visibility: updateEditInternal ? "INTERNAL" : "CUSTOMER_VISIBLE",
  });

  const commentEditForm = useForm<CommentEditFormValues>({
    resolver: zodResolver(commentEditFormSchema),
    defaultValues: { body: "", internal: false },
  });
  const activeTab = tab;
  const deliveryActive = isProjectDeliveryActive(project.status);
  const { unread } = useUnreadNotifications();
  const { mutate: markRead } = useMarkNotificationsRead();
  const requestIdSet = new Set(requests.map((item) => item.id));
  const updateUnread = countProjectUpdateUnread(unread, project.id);
  const requestUnread = countProjectRequestUnread(
    unread,
    project.id,
    requestIdSet,
  );
  const projectScopeCounts = useMemo(
    () => ({
      overview: countProjectScopeUnread(unread, project.id, "overview"),
      milestones: countProjectScopeUnread(unread, project.id, "milestones"),
      updates: updateUnread,
      files: countProjectScopeUnread(unread, project.id, "files"),
    }),
    [project.id, unread, updateUnread],
  );

  useEffect(() => {
    if (!(activeTab in projectScopeCounts)) return;
    const scope = activeTab as keyof typeof projectScopeCounts;
    if (projectScopeCounts[scope] === 0) return;
    markRead({ projectId: project.id, projectScope: scope });
  }, [activeTab, markRead, project.id, projectScopeCounts]);

  async function confirmDeleteUpdate() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await staffApi<{ deleted: true }>(
        `/api/v1/projects/${project.id}/updates/${deleteTarget.id}`,
        jsonRequest("DELETE"),
      );
      setDeleteTarget(null);
      toast.success("进度动态已删除");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "进度动态删除失败");
    } finally {
      setDeleting(false);
    }
  }

  function openEditUpdate(update: ProjectUpdate) {
    updateEditForm.reset({
      title: update.title,
      body: update.body,
      internal: update.visibility === "INTERNAL",
    });
    setEditUpdateTarget(update);
  }

  const submitEditUpdate = updateEditForm.handleSubmit(async (values) => {
    if (!editUpdateTarget) return;
    setSavingEdit(true);
    try {
      await staffApi(
        `/api/v1/projects/${project.id}/updates/${editUpdateTarget.id}`,
        jsonRequest("PATCH", {
          title: values.title,
          body: values.body,
          visibility: values.internal ? "INTERNAL" : "CUSTOMER_VISIBLE",
        }),
      );
      setEditUpdateTarget(null);
      setInlineImageUploading(false);
      toast.success("进度动态已更新");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "进度动态更新失败");
    } finally {
      setSavingEdit(false);
    }
  });

  function openEditComment(update: ProjectUpdate, comment: CommentItem) {
    commentEditForm.reset({
      body: comment.body,
      internal: comment.visibility === "INTERNAL",
    });
    setEditCommentTarget({ update, comment });
  }

  const submitEditComment = commentEditForm.handleSubmit(async (values) => {
    if (!editCommentTarget) return;
    setSavingEdit(true);
    try {
      await staffApi(
        `/api/v1/projects/${project.id}/updates/${editCommentTarget.update.id}/comments/${editCommentTarget.comment.id}`,
        jsonRequest("PATCH", {
          body: values.body,
          visibility: values.internal ? "INTERNAL" : "CUSTOMER_VISIBLE",
        }),
      );
      setEditCommentTarget(null);
      toast.success("评论已更新");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "评论更新失败");
    } finally {
      setSavingEdit(false);
    }
  });

  return (
    <Stack spacing={3} sx={{ width: "100%" }}>
      <Paper variant="outlined">
        <Tabs
          value={activeTab}
          onChange={(_, value: ProjectTab) => setTab(value)}
          variant="scrollable"
          scrollButtons={false}
          sx={{ px: { xs: 1, sm: 2 } }}
        >
          <Tab
            value="overview"
            label={
              <TabBadgeLabel
                label="项目概览"
                count={projectScopeCounts.overview}
              />
            }
          />
          {deliveryActive ? (
            <Tab
              value="milestones"
              label={
                <TabBadgeLabel
                  label={`里程碑 ${project.milestones.length}`}
                  count={projectScopeCounts.milestones}
                />
              }
            />
          ) : null}
          {deliveryActive ? (
            <Tab
              value="updates"
              label={
                <TabBadgeLabel
                  label={`进度动态 ${project.updates.length}`}
                  count={updateUnread}
                />
              }
            />
          ) : null}
          {deliveryActive ? (
            <Tab
              value="requests"
              label={
                <TabBadgeLabel
                  label={`服务请求 ${requests.length}`}
                  count={requestUnread}
                />
              }
            />
          ) : null}
          {deliveryActive ? (
            <Tab
              value="files"
              label={
                <TabBadgeLabel
                  label={`文件资料 ${project.attachments.length}`}
                  count={projectScopeCounts.files}
                />
              }
            />
          ) : null}
          {project.kind === "EXTERNAL_INTEGRATION" ? (
            <Tab value="integration" label="外部接入" />
          ) : null}
          {project.kind === "EXTERNAL_INTEGRATION" && deliveryActive ? (
            <Tab value="contacts" label="外部联系人" />
          ) : null}
        </Tabs>
      </Paper>

      {activeTab === "overview" ? (
        <Stack spacing={3}>
          <Paper variant="outlined" sx={{ p: { xs: 2.25, md: 3 } }}>
            <Typography variant="h3">交付概况</Typography>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: {
                  xs: "1fr",
                  sm: "repeat(2, minmax(0, 1fr))",
                  lg: "repeat(4, minmax(0, 1fr))",
                },
                gap: 3,
                mt: 3,
              }}
            >
              <SummaryField
                label={project.kind === "EXTERNAL_INTEGRATION" ? "接入对象" : "客户"}
                value={
                  project.kind === "EXTERNAL_INTEGRATION"
                    ? `${project.externalConnectorLabel ?? "外部接入"} 用户`
                    : project.customerSpace.name
                }
              />
              <SummaryField label="服务类型" value={project.serviceType.name} />
              <SummaryField
                label="当前阶段"
                value={project.currentStage || "待启动"}
              />
              <SummaryField
                label="服务周期"
                value={`${formatDate(project.startDate)} — ${formatDate(project.endDate)}`}
              />
            </Box>
            <Divider sx={{ my: 3 }} />
            <Stack spacing={1.25}>
              <Stack direction="row" sx={{ justifyContent: "space-between" }}>
                <Typography sx={{ fontWeight: 650 }}>整体进度</Typography>
                <Typography color="primary.main" sx={{ fontWeight: 650 }}>
                  {project.progress}%
                </Typography>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={project.progress}
                sx={{ height: 7, borderRadius: 4 }}
              />
            </Stack>
          </Paper>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", lg: "1.2fr 0.8fr" },
              gap: 3,
            }}
          >
            <Paper variant="outlined" sx={{ p: { xs: 2.25, md: 3 } }}>
              <Typography variant="h3">项目说明</Typography>
              <Typography
                color={project.description ? "text.primary" : "text.secondary"}
                sx={{ mt: 2, lineHeight: 1.8, whiteSpace: "pre-wrap" }}
              >
                {project.description || "尚未填写项目说明。"}
              </Typography>
            </Paper>
            <Paper variant="outlined" sx={{ p: { xs: 2.25, md: 3 } }}>
              <ProjectStaffManager
                projectId={project.id}
                staff={project.staff}
                candidates={staffCandidates}
                canEdit={canManageStaff}
              />
            </Paper>
          </Box>
        </Stack>
      ) : null}

      {activeTab === "milestones" && deliveryActive ? (
        <MilestoneManager
          projectId={project.id}
          milestones={project.milestones}
          canManage={canManageDelivery}
          contentRiskEnabled={Boolean(project.contentRiskUiEnabled)}
          contentRiskNoticeEnabled={contentRiskNoticeEnabled}
        />
      ) : null}

      {activeTab === "updates" && deliveryActive ? (
        <Stack spacing={1.5}>
          {project.updates.map((update) => (
            <Paper key={update.id} variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: "flex-start", justifyContent: "space-between" }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    {update.contentRiskStatus === "REVOKED" ? (
                      <ContentRiskStatusLine
                        status="REVOKED"
                        pluginEnabled={Boolean(project.contentRiskUiEnabled)}
                      />
                    ) : (
                      <Typography variant="h3" sx={{ overflowWrap: "anywhere" }}>
                        {update.title}
                      </Typography>
                    )}
                    {update.visibility === "INTERNAL" ? (
                      <LockOutlinedIcon fontSize="small" color="action" />
                    ) : null}
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                    {update.authorName} · {dateFormatter.format(new Date(update.createdAt))}
                    {update.hasEditHistory ? (
                      <EditedAtLabel
                        updatedAt={update.updatedAt}
                        onClick={() =>
                          setHistoryTarget({
                            kind: "update",
                            projectId: project.id,
                            projectUpdateId: update.id,
                            label: update.title,
                          })
                        }
                      />
                    ) : null}
                  </Typography>
                </Box>
                {canPublishUpdate ? (
                  <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
                    <Tooltip title="编辑进度">
                      <span>
                        <IconButton
                          size="small"
                          aria-label={`编辑进度 ${update.title}`}
                          onClick={() => openEditUpdate(update)}
                          disabled={update.contentRiskStatus === "REVOKED"}
                        >
                          <EditOutlinedIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="删除进度">
                      <span>
                        <IconButton
                          size="small"
                          color="error"
                          aria-label={`删除进度 ${update.title}`}
                          onClick={() => setDeleteTarget(update)}
                          disabled={deleting}
                        >
                          <DeleteOutlineOutlinedIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                ) : null}
              </Stack>
              {update.contentRiskStatus === "PENDING" ? (
                <ContentRiskStatusLine
                  status="PENDING"
                  pluginEnabled={Boolean(project.contentRiskUiEnabled)}
                />
              ) : null}
              {update.contentRiskStatus !== "REVOKED" ? (
                <CollapsibleText text={update.body} maxLines={16} />
              ) : null}
              {update.contentRiskStatus !== "REVOKED" && update.comments.length > 0 ? (
                <Stack
                  spacing={1.5}
                  sx={{
                    mt: 2.5,
                    pl: 2,
                    borderLeft: "2px solid",
                    borderColor: "divider",
                  }}
                >
                  {update.comments.map((comment) => (
                    <Box key={comment.id}>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: "flex-start", justifyContent: "space-between" }}
                      >
                        <Typography variant="body2" sx={{ fontWeight: 650 }}>
                          {comment.authorName}
                          {comment.visibility === "INTERNAL" ? " · 内部评论" : ""}
                          {comment.hasEditHistory ? (
                            <EditedAtLabel
                              updatedAt={comment.updatedAt}
                              onClick={() =>
                                setHistoryTarget({
                                  kind: "comment",
                                  projectId: project.id,
                                  projectUpdateId: update.id,
                                  updateCommentId: comment.id,
                                  label: `${update.title} · 评论`,
                                })
                              }
                            />
                          ) : null}
                        </Typography>
                        {(canEditProject || comment.authorId === currentUserId) &&
                        comment.contentRiskStatus !== "REVOKED" ? (
                          <Tooltip title="编辑评论">
                            <span>
                              <IconButton
                                size="small"
                                aria-label="编辑评论"
                                onClick={() => openEditComment(update, comment)}
                                sx={{ flexShrink: 0 }}
                              >
                                <EditOutlinedIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        ) : null}
                      </Stack>
                      {comment.contentRiskStatus === "REVOKED" ? (
                        <ContentRiskStatusLine
                          status="REVOKED"
                          pluginEnabled={Boolean(project.contentRiskUiEnabled)}
                        />
                      ) : (
                        <>
                          <CollapsibleText
                            text={comment.body}
                            maxLines={6}
                          />
                          <ContentRiskStatusLine
                            status={comment.contentRiskStatus}
                            pluginEnabled={Boolean(project.contentRiskUiEnabled)}
                          />
                        </>
                      )}
                    </Box>
                  ))}
                </Stack>
              ) : null}
            </Paper>
          ))}
          {project.updates.length === 0 ? (
            <Paper variant="outlined" sx={{ p: 0 }}>
              <EmptyState icon={<UpdateOutlinedIcon />} title="尚未发布项目进度" />
            </Paper>
          ) : null}

          <Dialog
            open={Boolean(deleteTarget)}
            onClose={deleting ? undefined : () => setDeleteTarget(null)}
            fullWidth
            maxWidth="xs"
          >
            <DialogTitle>删除进度动态</DialogTitle>
            <DialogContent>
              <Typography color="text.secondary">
                确认删除“{deleteTarget?.title}”？正文、评论和其中的图片将一并删除，此操作不可恢复。
              </Typography>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 3 }}>
              <Button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                取消
              </Button>
              <Button
                color="error"
                variant="contained"
                onClick={() => void confirmDeleteUpdate()}
                disabled={deleting}
              >
                {deleting ? "删除中..." : "确认删除"}
              </Button>
            </DialogActions>
          </Dialog>

          <UpdateHistoryDialog
            target={historyTarget}
            onClose={() => setHistoryTarget(null)}
          />

          <Dialog
            open={Boolean(editUpdateTarget)}
            onClose={savingEdit ? undefined : () => setEditUpdateTarget(null)}
            fullWidth
            maxWidth="sm"
            slotProps={{
              paper: { sx: { maxHeight: "calc(100dvh - 48px)" } },
            }}
          >
            <Stack
              component="form"
              onSubmit={submitEditUpdate}
              sx={{ minHeight: 0, maxHeight: "inherit", overflow: "hidden" }}
            >
              {savingEdit ? <LinearProgress /> : null}
              <DialogTitle>编辑进度动态</DialogTitle>
              <DialogContent sx={{ overflowY: "auto" }}>
                <Stack spacing={2} sx={{ pt: 1 }}>
                  {contentRiskNoticeEnabled && !updateEditInternal ? (
                    <ContentRiskNotice audience="STAFF" />
                  ) : null}
                  <Controller
                    name="title"
                    control={updateEditForm.control}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        label="动态标题"
                        required
                        error={Boolean(updateEditForm.formState.errors.title)}
                        helperText={updateEditForm.formState.errors.title?.message}
                      />
                    )}
                  />
                  <Stack spacing={1}>
                    <Typography sx={{ fontWeight: 650 }}>进度说明 *</Typography>
                    <Controller
                      name="body"
                      control={updateEditForm.control}
                      render={({ field }) => (
                        <RichTextEditor
                          value={field.value}
                          onChange={field.onChange}
                          placeholder="说明本次进展、已完成事项和下一步安排"
                          disabled={savingEdit}
                          minHeight={180}
                          maxHeight={320}
                          uploadImage={uploadInlineImage}
                          onImageUploadingChange={setInlineImageUploading}
                        />
                      )}
                    />
                    {updateEditForm.formState.errors.body?.message ? (
                      <Typography variant="caption" color="error">
                        {updateEditForm.formState.errors.body.message}
                      </Typography>
                    ) : null}
                  </Stack>
                  <Controller
                    name="internal"
                    control={updateEditForm.control}
                    render={({ field }) => (
                      <FormControlLabel
                        control={
                          <Switch
                            checked={field.value}
                            onChange={(_, checked) => field.onChange(checked)}
                          />
                        }
                        label="仅内部可见"
                      />
                    )}
                  />
                </Stack>
              </DialogContent>
              <DialogActions sx={{ px: 3, pb: 3 }}>
                <Button
                  onClick={() => setEditUpdateTarget(null)}
                  disabled={savingEdit}
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  variant="contained"
                  disabled={
                    savingEdit ||
                    inlineImageUploading ||
                    !hasMeaningfulHtml(updateEditBody)
                  }
                >
                  保存
                </Button>
              </DialogActions>
            </Stack>
          </Dialog>

          <Dialog
            open={Boolean(editCommentTarget)}
            onClose={savingEdit ? undefined : () => setEditCommentTarget(null)}
            fullWidth
            maxWidth="sm"
          >
            <Stack component="form" onSubmit={submitEditComment}>
              {savingEdit ? <LinearProgress /> : null}
              <DialogTitle>编辑评论</DialogTitle>
              <DialogContent>
                <Stack spacing={2} sx={{ pt: 1 }}>
                  <Controller
                    name="body"
                    control={commentEditForm.control}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        label="评论内容"
                        required
                        multiline
                        minRows={3}
                        maxRows={10}
                        error={Boolean(commentEditForm.formState.errors.body)}
                        helperText={commentEditForm.formState.errors.body?.message}
                      />
                    )}
                  />
                  <Controller
                    name="internal"
                    control={commentEditForm.control}
                    render={({ field }) => (
                      <FormControlLabel
                        control={
                          <Switch
                            checked={field.value}
                            onChange={(_, checked) => field.onChange(checked)}
                          />
                        }
                        label="仅内部可见"
                      />
                    )}
                  />
                </Stack>
              </DialogContent>
              <DialogActions sx={{ px: 3, pb: 3 }}>
                <Button
                  onClick={() => setEditCommentTarget(null)}
                  disabled={savingEdit}
                >
                  取消
                </Button>
                <Button type="submit" variant="contained" disabled={savingEdit}>
                  保存
                </Button>
              </DialogActions>
            </Stack>
          </Dialog>
        </Stack>
      ) : null}

      {activeTab === "requests" && deliveryActive ? (
        <RequestTable requests={requests} hideProjectFilter />
      ) : null}
      {activeTab === "files" && deliveryActive ? (
        <ProjectFileManager
          projectId={project.id}
          files={project.attachments}
          canUpload={canUploadFiles}
          contentRiskEnabled={Boolean(project.contentRiskUiEnabled)}
          contentRiskNoticeEnabled={contentRiskNoticeEnabled}
        />
      ) : null}
      {activeTab === "integration" && project.kind === "EXTERNAL_INTEGRATION" ? (
        project.externalConnectorKey === "universal-embed-connector" ? (
          <UniversalIntegrationPanel projectId={project.id} canEdit={canEditProject} />
        ) : (
          <Sub2ApiIntegrationPanel projectId={project.id} canEdit={canEditProject} />
        )
      ) : null}
      {activeTab === "contacts" &&
      project.kind === "EXTERNAL_INTEGRATION" &&
      deliveryActive ? (
        <ExternalContactsPanel projectId={project.id} />
      ) : null}
    </Stack>
  );
}
