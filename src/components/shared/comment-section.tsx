"use client";

import type { ReactNode } from "react";
import { Box, IconButton, Stack, Tooltip } from "@mui/material";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import {
  UpdateCommentList,
  type UpdateCommentListItem,
} from "@/components/shared/update-comment-list";

/**
 * 详情弹窗里的常驻评论区。
 *
 * 评论跟着内容走：进详情就能看全部评论、直接回复，而不是「点评论换一个弹窗」。
 * 列表与头像样式复用 UpdateCommentList，这里只负责把编辑/删除操作挂到条目上。
 * 编辑与删除分别授权：编辑通常只限作者本人，但有评论管理权限的员工可以删除
 * 客户评论，不能把两个动作绑在同一个「是作者」判断上。
 */
export function CommentSection({
  comments,
  currentUserId,
  contentRiskEnabled,
  dateFormatter,
  emptyText,
  busy = false,
  onEdit,
  onDelete,
  canEditComment,
  canDeleteComment,
  composer,
}: {
  comments: UpdateCommentListItem[];
  currentUserId?: string | null;
  contentRiskEnabled: boolean;
  dateFormatter: Intl.DateTimeFormat;
  emptyText?: string;
  /** 发送/编辑/删除进行中：期间不再亮操作按钮 */
  busy?: boolean;
  onEdit?: (comment: UpdateCommentListItem) => void;
  onDelete?: (comment: UpdateCommentListItem) => void;
  /** 不传时编辑默认只限作者本人 */
  canEditComment?: (comment: UpdateCommentListItem) => boolean;
  /** 不传时删除默认只限作者本人 */
  canDeleteComment?: (comment: UpdateCommentListItem) => boolean;
  /** 底部输入区，没有发表权限时传 null/undefined */
  composer?: ReactNode;
}) {
  const isOwn = (comment: UpdateCommentListItem) =>
    currentUserId != null && comment.authorId === currentUserId;

  return (
    <Stack spacing={1.5}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", color: "text.secondary" }}
      >
        <Box component="span" sx={{ fontWeight: 650 }}>
          评论{comments.length > 0 ? ` ${comments.length}` : ""}
        </Box>
      </Stack>
      <UpdateCommentList
        items={comments.map((comment) => ({
          ...comment,
          action: (() => {
            if (busy || comment.contentRiskStatus === "REVOKED") return null;
            const canEdit = Boolean(
              onEdit && (canEditComment?.(comment) ?? isOwn(comment)),
            );
            const canDelete = Boolean(
              onDelete && (canDeleteComment?.(comment) ?? isOwn(comment)),
            );
            if (!canEdit && !canDelete) return null;
            return (
              <Stack
                direction="row"
                spacing={0.25}
                sx={{ flexShrink: 0 }}
              >
                {canEdit ? (
                  <Tooltip title="编辑评论">
                    <span>
                      <IconButton
                        size="small"
                        aria-label="编辑评论"
                        onClick={() => onEdit?.(comment)}
                      >
                        <EditOutlinedIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                ) : null}
                {canDelete ? (
                  <Tooltip title="删除评论">
                    <span>
                      <IconButton
                        size="small"
                        color="error"
                        aria-label="删除评论"
                        onClick={() => onDelete?.(comment)}
                      >
                        <DeleteOutlineOutlinedIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                ) : null}
              </Stack>
            );
          })(),
        }))}
        contentRiskEnabled={contentRiskEnabled}
        dateFormatter={dateFormatter}
        {...(emptyText ? { emptyText } : {})}
      />
      {composer}
    </Stack>
  );
}
