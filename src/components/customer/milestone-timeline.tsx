"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  TextField,
} from "@mui/material";
import type { ProjectMilestone } from "@/components/customer/customer-types";
import {
  MilestoneList,
  type MilestoneCommentItem,
} from "@/components/shared/milestone-list";
import { useToast } from "@/components/shared/toast-provider";
import { apiRequest, jsonRequest } from "@/lib/api-client";
import {
  escapeHtmlText,
  htmlToPlainText,
} from "@/lib/message-content";

/** 纯文本评论转安全 HTML：转义后保留换行，与动态评论一致。 */
function commentTextToHtml(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return `<p>${escapeHtmlText(trimmed).replace(/\n/g, "<br/>")}</p>`;
}

export function MilestoneTimeline({
  milestones,
  projectId,
  currentUserId,
  contentRiskEnabled = false,
}: {
  milestones: ProjectMilestone[];
  /** 传了才开放评论输入；里程碑详情弹窗的评论走这个 id */
  projectId?: string;
  currentUserId?: string | null;
  contentRiskEnabled?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  // 评论输入由时间线持有：切换里程碑/提交后统一清空
  const [commentText, setCommentText] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [editComment, setEditComment] = useState<{
    milestone: ProjectMilestone;
    comment: MilestoneCommentItem;
    text: string;
  } | null>(null);

  async function submitComment(milestone: ProjectMilestone) {
    if (!projectId) return;
    const body = commentTextToHtml(commentText);
    if (!body) {
      toast.warning("请输入评论内容");
      return;
    }
    setCommentBusy(true);
    try {
      await apiRequest(
        `/api/v1/projects/${projectId}/milestones/${milestone.id}/comments`,
        jsonRequest("POST", { body }),
        "评论发送失败",
      );
      setCommentText("");
      toast.success("评论已发送");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "评论发送失败");
    } finally {
      setCommentBusy(false);
    }
  }

  async function submitEditComment() {
    if (!editComment || !projectId) return;
    const body = commentTextToHtml(editComment.text);
    if (!body) {
      toast.warning("请输入评论内容");
      return;
    }
    setCommentBusy(true);
    try {
      await apiRequest(
        `/api/v1/projects/${projectId}/milestones/${editComment.milestone.id}/comments/${editComment.comment.id}`,
        jsonRequest("PATCH", { body }),
        "评论更新失败",
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

  return (
    <>
      <MilestoneList
        milestones={milestones}
        contentRiskEnabled={contentRiskEnabled}
        collapsible
        currentUserId={currentUserId ?? null}
        canComment={Boolean(projectId)}
        composerValue={commentText}
        onComposerChange={setCommentText}
        onDetailChange={() => setCommentText("")}
        composerPlaceholder="向服务人员留言…"
        commentBusy={commentBusy}
        onSubmitComment={(milestone) => {
          void submitComment(milestone as ProjectMilestone);
        }}
        onEditComment={(milestone, comment) =>
          setEditComment({
            milestone: milestone as ProjectMilestone,
            comment,
            // 评论只产出纯文本（转义后包一层 <p>），编辑框里要还原成纯文本
            text: htmlToPlainText(comment.body),
          })
        }
      />

      {/* 编辑自己的评论；客户端不提供删除入口（违规内容走内容风控撤回） */}
      <Dialog
        open={Boolean(editComment)}
        onClose={commentBusy ? undefined : () => setEditComment(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>编辑评论</DialogTitle>
        <DialogContent>
          {commentBusy ? <LinearProgress sx={{ mb: 2 }} /> : null}
          <TextField
            label="评论内容"
            value={editComment?.text ?? ""}
            onChange={(event) =>
              setEditComment(
                editComment ? { ...editComment, text: event.target.value } : null,
              )
            }
            fullWidth
            multiline
            minRows={3}
            maxRows={8}
            disabled={commentBusy}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setEditComment(null)} disabled={commentBusy}>
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
    </>
  );
}
