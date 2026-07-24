"use client";

import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import RestoreOutlinedIcon from "@mui/icons-material/RestoreOutlined";
import { htmlToPlainText } from "@/lib/message-content";

export type ContentRiskReviewRecord = {
  id: string;
  targetType: string;
  status: string;
  decision: string | null;
  riskCategories: unknown;
  serviceRequestId: string | null;
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
  restoredAt: string | null;
  actorName: string | null;
  decisionReason: string | null;
  durationMs: number | null;
  contentSnapshot: {
    title?: string | null;
    body?: string | null;
    attachmentIds?: string[];
  } | null;
};

const targetLabels: Record<string, string> = {
  SERVICE_REQUEST: "新建服务请求",
  REQUEST_MESSAGE: "服务请求回复",
  PROJECT_UPDATE: "项目进度",
  UPDATE_COMMENT: "进度评论",
  MILESTONE: "项目里程碑",
  ATTACHMENT: "公开附件",
};

const statusLabels: Record<string, string> = {
  QUEUED: "等待复查",
  PROCESSING: "正在复查",
  PASSED: "已通过",
  VIOLATION: "已撤回",
  UNCERTAIN: "待人工确认",
  CANCELLED: "已取消",
  FAILED: "检测失败",
};

export function ContentRiskHistoryDialog({
  open,
  reviews,
  onClose,
  onRestore,
}: {
  open: boolean;
  reviews: ContentRiskReviewRecord[];
  onClose: () => void;
  onRestore: (reviewId: string) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" scroll="paper">
      <DialogTitle>历史风控记录</DialogTitle>
      <DialogContent dividers sx={{ px: { xs: 2, sm: 3 }, py: 2 }}>
        {reviews.length === 0 ? (
          <Box sx={{ py: 6, textAlign: "center" }}>
            <Typography color="text.secondary">暂无风控记录</Typography>
          </Box>
        ) : (
          <Stack spacing={1.5}>
            {reviews.map((review) => (
              <Paper key={review.id} variant="outlined" sx={{ p: 1.5, borderRadius: 1 }}>
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1.5}
                  sx={{ justifyContent: "space-between", alignItems: { sm: "flex-start" } }}
                >
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 650 }}>
                      {targetLabels[review.targetType] ?? review.targetType} ·{" "}
                      {statusLabels[review.status] ?? review.status}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {review.actorName ? `${review.actorName} · ` : ""}
                      {new Date(review.createdAt).toLocaleString("zh-CN", { hour12: false })}
                      {review.durationMs != null
                        ? ` · ${Math.max(1, Math.round(review.durationMs / 1000))} 秒`
                        : ""}
                      {review.lastError ? ` · ${review.lastError}` : ""}
                    </Typography>
                    {review.decisionReason ? (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                        模型判断：{review.decisionReason}
                      </Typography>
                    ) : null}
                    {review.contentSnapshot ? (
                      <Box
                        sx={{
                          mt: 1,
                          p: 1.25,
                          bgcolor: "action.hover",
                          borderRadius: 1,
                          maxHeight: 180,
                          overflowY: "auto",
                        }}
                      >
                        <Typography variant="caption" color="text.secondary">
                          受限原始内容
                        </Typography>
                        <Typography
                          variant="body2"
                          sx={{ mt: 0.35, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                        >
                          {[
                            review.contentSnapshot.title,
                            review.contentSnapshot.body
                              ? htmlToPlainText(review.contentSnapshot.body)
                              : null,
                          ]
                            .filter(Boolean)
                            .join("\n") || "仅包含附件"}
                        </Typography>
                      </Box>
                    ) : null}
                  </Box>
                  {review.status === "VIOLATION" && !review.restoredAt ? (
                    <Button
                      size="small"
                      startIcon={<RestoreOutlinedIcon />}
                      onClick={() => onRestore(review.id)}
                      sx={{ flexShrink: 0 }}
                    >
                      确认误判并恢复
                    </Button>
                  ) : null}
                </Stack>
              </Paper>
            ))}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  );
}
