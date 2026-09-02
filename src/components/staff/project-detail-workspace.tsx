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
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import AttachFileOutlinedIcon from "@mui/icons-material/AttachFileOutlined";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import { CollapsibleText } from "@/components/shared/collapsible-text";
import { EmptyState } from "@/components/shared/content-state";
import { RichTextEditor } from "@/components/shared/rich-text-editor";
import { useToast } from "@/components/shared/toast-provider";
import { useInlineImageUpload } from "@/hooks/use-inline-image-upload";
import {
  escapeHtmlText,
  extractInlineAttachmentIds,
  hasMeaningfulHtml,
  htmlToPlainText,
} from "@/lib/message-content";
import { ProjectStaffManager } from "@/components/staff/project-staff-manager";
import { ProjectFileManager } from "@/components/staff/project-file-manager";
import { isProjectDeliveryActive } from "@/components/staff/project-delivery-state";
import { MilestoneManager } from "@/components/staff/milestone-manager";
import { TabBadgeLabel } from "@/components/shared/tab-badge-label";
import { CommentSection } from "@/components/shared/comment-section";
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

/** 纯文本评论转安全 HTML：转义后保留换行，与小程序端一致。 */
function commentTextToHtml(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return `<p>${escapeHtmlText(trimmed).replace(/\n/g, "<br/>")}</p>`;
}

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
  canComment,
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
  canComment: boolean;
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
  const [detailId, setDetailId] = useState<string | null>(null);
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
  const commentCreateForm = useForm<CommentEditFormValues>({
    resolver: zodResolver(commentEditFormSchema),
    defaultValues: { body: "", internal: false },
  });
  const [postingComment, setPostingComment] = useState(false);
  const activeTab = tab;
  const deliveryActive = isProjectDeliveryActive(project.status);
  const detailUpdate =
    detailId != null
      ? project.updates.find((item) => item.id === detailId) ?? null
      : null;
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

  useEffect(() => {
    // 换一条动态（或关掉弹窗）时清空评论输入，别把上一条的内容带过去
    commentCreateForm.reset({ body: "", internal: false });
  }, [detailId, commentCreateForm]);

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
      // 评论各端都只产出纯文本（转义后包一层 <p>），编辑框里要还原成纯文本，
      // 否则用户看到并且会一起改掉 <p>/<br/> 标签本身
      body: htmlToPlainText(comment.body),
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
          body: commentTextToHtml(values.body),
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

  const submitCreateComment = commentCreateForm.handleSubmit(async (values) => {
    if (!detailUpdate) return;
    setPostingComment(true);
    try {
      await staffApi(
        `/api/v1/projects/${project.id}/updates/${detailUpdate.id}/comments`,
        jsonRequest("POST", {
          body: commentTextToHtml(values.body),
          visibility: values.internal ? "INTERNAL" : "CUSTOMER_VISIBLE",
        }),
      );
      commentCreateForm.reset({ body: "", internal: false });
      toast.success("评论已发送");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "评论发送失败");
    } finally {
      setPostingComment(false);
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
          canComment={canComment}
          currentUserId={currentUserId}
          contentRiskEnabled={Boolean(project.contentRiskUiEnabled)}
          contentRiskNoticeEnabled={contentRiskNoticeEnabled}
        />
      ) : null}

      {activeTab === "updates" && deliveryActive ? (
        <Stack spacing={2}>
          {project.updates.length > 0 ? (
            <Paper variant="outlined" sx={{ overflow: "hidden" }}>
              {project.updates.map((update, index) => {
                const revoked = update.contentRiskStatus === "REVOKED";
                const preview = htmlToPlainText(update.body);
                const hasImages =
                  extractInlineAttachmentIds(update.body).length > 0 ||
                  /<img\b/i.test(update.body);
                const replyCount = update.comments.length;
                return (
                  <Box
                    key={update.id}
                    sx={{
                      p: { xs: 1.25, md: 1.5 },
                      borderBottom:
                        index === project.updates.length - 1 ? 0 : "1px solid",
                      borderColor: "divider",
                    }}
                  >
                    <Box
                      sx={{
                        display: "grid",
                        gridTemplateColumns: {
                          xs: "minmax(0, 1fr)",
                          md: "minmax(0, 1fr) minmax(190px, auto)",
                        },
                        columnGap: 3,
                        rowGap: 1.25,
                        alignItems: "start",
                      }}
                    >
                      <Stack spacing={0.75} sx={{ minWidth: 0 }}>
                        {revoked ? (
                          <ContentRiskStatusLine
                            status="REVOKED"
                            pluginEnabled={Boolean(project.contentRiskUiEnabled)}
                          />
                        ) : (
                          <Stack
                            direction="row"
                            spacing={1}
                            useFlexGap
                            sx={{ alignItems: "center", flexWrap: "wrap" }}
                          >
                            <Typography
                              sx={{ fontWeight: 650, overflowWrap: "anywhere" }}
                            >
                              {update.title}
                            </Typography>
                            {update.visibility === "INTERNAL" ? (
                              <LockOutlinedIcon fontSize="small" color="action" />
                            ) : null}
                          </Stack>
                        )}
                        {!revoked && update.contentRiskStatus === "PENDING" ? (
                          <ContentRiskStatusLine
                            status="PENDING"
                            pluginEnabled={Boolean(project.contentRiskUiEnabled)}
                          />
                        ) : null}
                        {!revoked && preview ? (
                          <Typography
                            color="text.secondary"
                            sx={{
                              lineHeight: 1.7,
                              display: "-webkit-box",
                              WebkitBoxOrient: "vertical",
                              WebkitLineClamp: 2,
                              overflow: "hidden",
                              wordBreak: "break-word",
                            }}
                          >
                            {preview}
                          </Typography>
                        ) : null}
                        {!revoked && hasImages ? (
                          <Stack
                            direction="row"
                            spacing={0.75}
                            sx={{ alignItems: "center", color: "text.secondary" }}
                          >
                            <ImageOutlinedIcon sx={{ fontSize: 17 }} />
                            <Typography variant="body2">
                              包含图片，请查看详情
                            </Typography>
                          </Stack>
                        ) : null}
                        {!revoked && (update.attachments?.length ?? 0) > 0 ? (
                          <Stack
                            direction="row"
                            spacing={0.75}
                            sx={{ alignItems: "center", color: "text.secondary" }}
                          >
                            <AttachFileOutlinedIcon sx={{ fontSize: 17 }} />
                            <Typography variant="body2">
                              {update.attachments!.length} 个附件（已收录到项目文件）
                            </Typography>
                          </Stack>
                        ) : null}
                      </Stack>
                      <Stack
                        spacing={0.75}
                        sx={{
                          minWidth: 0,
                          pt: { xs: 1.25, md: 0 },
                          borderTop: { xs: "1px solid", md: 0 },
                          borderColor: "divider",
                          alignItems: { xs: "flex-start", md: "flex-end" },
                          textAlign: { xs: "left", md: "right" },
                        }}
                      >
                        <Box>
                          <Typography variant="body2" color="text.secondary">
                            {update.authorName}
                          </Typography>
                        </Box>
                        <Box>
                          <Typography variant="body2" color="text.secondary">
                            {dateTimeFormatter.format(new Date(update.createdAt))}
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
                        <Stack
                          direction="row"
                          spacing={0.75}
                          useFlexGap
                          sx={{
                            width: "100%",
                            alignItems: "center",
                            justifyContent: { xs: "flex-start", md: "flex-end" },
                            flexWrap: "wrap",
                          }}
                        >
                          {!revoked ? (
                            <>
                              <Button
                                size="small"
                                color="primary"
                                startIcon={<VisibilityOutlinedIcon />}
                                onClick={() => setDetailId(update.id)}
                              >
                                查看详情
                              </Button>
                              {/* 评论在详情弹窗里常驻：回复数只做提示，不再单独开弹窗 */}
                              <Typography variant="body2" color="text.secondary">
                                {replyCount > 0 ? `${replyCount} 条评论` : null}
                              </Typography>
                            </>
                          ) : null}
                          {canPublishUpdate ? (
                            <>
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
                            </>
                          ) : null}
                        </Stack>
                      </Stack>
                    </Box>
                  </Box>
                );
              })}
            </Paper>
          ) : (
            <Paper variant="outlined" sx={{ p: 0 }}>
              <EmptyState icon={<UpdateOutlinedIcon />} title="尚未发布项目进度" />
            </Paper>
          )}

          <Dialog
            open={Boolean(detailUpdate)}
            onClose={() => setDetailId(null)}
            fullWidth
            maxWidth="md"
            slotProps={{
              paper: { sx: { maxHeight: "calc(100dvh - 48px)" } },
            }}
          >
            {detailUpdate ? (
              <>
                <DialogTitle>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: "center" }}
                  >
                    <Box component="span" sx={{ overflowWrap: "anywhere" }}>
                      {detailUpdate.title}
                    </Box>
                    {detailUpdate.visibility === "INTERNAL" ? (
                      <LockOutlinedIcon fontSize="small" color="action" />
                    ) : null}
                  </Stack>
                </DialogTitle>
                <DialogContent dividers sx={{ overflowY: "auto" }}>
                  <Stack spacing={2}>
                    <Typography variant="body2" color="text.secondary">
                      {detailUpdate.authorName} ·{" "}
                      {dateFormatter.format(new Date(detailUpdate.createdAt))}
                      {detailUpdate.hasEditHistory ? (
                        <EditedAtLabel
                          updatedAt={detailUpdate.updatedAt}
                          onClick={() =>
                            setHistoryTarget({
                              kind: "update",
                              projectId: project.id,
                              projectUpdateId: detailUpdate.id,
                              label: detailUpdate.title,
                            })
                          }
                        />
                      ) : null}
                    </Typography>
                    {detailUpdate.contentRiskStatus === "PENDING" ? (
                      <ContentRiskStatusLine
                        status="PENDING"
                        pluginEnabled={Boolean(project.contentRiskUiEnabled)}
                      />
                    ) : null}
                    <CollapsibleText
                      text={detailUpdate.body}
                      collapsible={false}
                    />
                    {/* 评论区常驻详情弹窗：评论跟着内容走，进来就能看能回 */}
                    {detailUpdate.contentRiskStatus !== "REVOKED" ? (
                      <CommentSection
                        comments={detailUpdate.comments.map((comment) => ({
                          id: comment.id,
                          body: comment.body,
                          authorId: comment.authorId,
                          authorName: comment.authorName,
                          authorImage: comment.authorImage,
                          createdAt: comment.createdAt,
                          contentRiskStatus: comment.contentRiskStatus,
                          badge:
                            comment.visibility === "INTERNAL"
                              ? " · 内部评论"
                              : null,
                          meta: comment.hasEditHistory ? (
                            <EditedAtLabel
                              updatedAt={comment.updatedAt}
                              onClick={() =>
                                setHistoryTarget({
                                  kind: "comment",
                                  projectId: project.id,
                                  projectUpdateId: detailUpdate.id,
                                  updateCommentId: comment.id,
                                  label: `${detailUpdate.title} · 评论`,
                                })
                              }
                            />
                          ) : null,
                        }))}
                        currentUserId={currentUserId}
                        contentRiskEnabled={Boolean(project.contentRiskUiEnabled)}
                        dateFormatter={dateTimeFormatter}
                        emptyText="还没有评论"
                        onEdit={(comment) => {
                          const target = detailUpdate.comments.find(
                            (item) => item.id === comment.id,
                          );
                          if (target) openEditComment(detailUpdate, target);
                        }}
                        composer={
                          canComment ? (
                            <Box component="form" onSubmit={submitCreateComment}>
                              {postingComment ? (
                                <LinearProgress sx={{ mb: 1 }} />
                              ) : null}
                              <Controller
                                control={commentCreateForm.control}
                                name="body"
                                render={({ field }) => (
                                  <TextField
                                    {...field}
                                    placeholder="回复客户或记录说明…"
                                    fullWidth
                                    multiline
                                    minRows={2}
                                    maxRows={6}
                                    size="small"
                                    disabled={postingComment}
                                    error={Boolean(
                                      commentCreateForm.formState.errors.body,
                                    )}
                                    helperText={
                                      commentCreateForm.formState.errors.body
                                        ?.message
                                    }
                                  />
                                )}
                              />
                              <Stack
                                direction="row"
                                spacing={1}
                                sx={{
                                  mt: 1,
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                }}
                              >
                                <Controller
                                  control={commentCreateForm.control}
                                  name="internal"
                                  render={({ field }) => (
                                    <FormControlLabel
                                      control={
                                        <Switch
                                          size="small"
                                          checked={field.value}
                                          onChange={(event) =>
                                            field.onChange(event.target.checked)
                                          }
                                        />
                                      }
                                      label="仅内部可见"
                                    />
                                  )}
                                />
                                <Button
                                  type="submit"
                                  size="small"
                                  variant="contained"
                                  disabled={postingComment}
                                >
                                  {postingComment ? "正在发送" : "发送"}
                                </Button>
                              </Stack>
                            </Box>
                          ) : null
                        }
                      />
                    ) : null}
                  </Stack>
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2.5 }}>
                  <Button onClick={() => setDetailId(null)}>关闭</Button>
                </DialogActions>
              </>
            ) : null}
          </Dialog>


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
          canPublishUpdate={canPublishUpdate}
          canManageDelivery={canManageDelivery}
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
