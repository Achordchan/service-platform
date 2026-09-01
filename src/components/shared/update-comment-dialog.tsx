"use client";

import type { ReactNode } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import {
  UpdateCommentList,
  type UpdateCommentListItem,
} from "@/components/shared/update-comment-list";

/**
 * 动态评论弹窗。
 *
 * 评论不再跟着列表行展开：一条动态的评论可以很多，展开会把整行撑爆、
 * 把后面的动态挤到屏幕外。弹窗里列表自己滚动，输入框固定在底部，
 * 员工端与客户端共用，各自只负责组装 items 与 composer。
 */
export function UpdateCommentDialog({
  open,
  onClose,
  title,
  items,
  contentRiskEnabled,
  dateFormatter,
  emptyText,
  composer,
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  /** 弹窗标题下方的动态标题，标明在给哪条动态评论 */
  title?: string;
  items: UpdateCommentListItem[];
  contentRiskEnabled: boolean;
  dateFormatter: Intl.DateTimeFormat;
  emptyText?: string;
  /** 底部输入区，没有发表权限时传 null */
  composer?: ReactNode;
  /** 正在发表/保存：期间不允许点遮罩关闭 */
  busy?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      // 关掉时不淡出：内容由父组件的选中项派生，一清空就成了空列表，
      // 淡出期间会闪一下「还没有评论」
      transitionDuration={{ enter: 225, exit: 0 }}
      slotProps={{
        paper: { sx: { maxHeight: "calc(100dvh - 48px)" } },
      }}
    >
      <DialogTitle sx={{ pb: title ? 1 : undefined }}>
        <Stack spacing={0.25}>
          <Box component="span">
            评论{items.length > 0 ? ` ${items.length}` : ""}
          </Box>
          {title ? (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ overflowWrap: "anywhere" }}
            >
              {title}
            </Typography>
          ) : null}
        </Stack>
      </DialogTitle>
      <DialogContent dividers sx={{ overflowY: "auto" }}>
        <UpdateCommentList
          items={items}
          contentRiskEnabled={contentRiskEnabled}
          dateFormatter={dateFormatter}
          {...(emptyText ? { emptyText } : {})}
        />
      </DialogContent>
      {composer ? (
        <Box sx={{ px: 3, pt: 2 }}>{composer}</Box>
      ) : null}
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={busy}>
          关闭
        </Button>
      </DialogActions>
    </Dialog>
  );
}
