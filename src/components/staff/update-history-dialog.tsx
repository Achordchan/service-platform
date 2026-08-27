"use client";

import { useEffect, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { staffApi } from "@/components/staff/staff-api";
import { CollapsibleText } from "@/components/shared/collapsible-text";
import { htmlToPlainText, truncatePlainText } from "@/lib/message-content";

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

type RevisionView = {
  id: string;
  title?: string | null;
  body: string;
  visibility: string;
  editedAt: string;
  editedByName: string;
};

export type UpdateHistoryTarget =
  | {
      kind: "update";
      projectId: string;
      projectUpdateId: string;
      label: string;
    }
  | {
      kind: "comment";
      projectId: string;
      projectUpdateId: string;
      updateCommentId: string;
      label: string;
    };

export function UpdateHistoryDialog({
  target,
  onClose,
}: {
  target: UpdateHistoryTarget | null;
  onClose: () => void;
}) {
  const [revisions, setRevisions] = useState<RevisionView[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    const path =
      target.kind === "update"
        ? `/api/v1/projects/${target.projectId}/updates/${target.projectUpdateId}/revisions`
        : `/api/v1/projects/${target.projectId}/updates/${target.projectUpdateId}/comments/${target.updateCommentId}/revisions`;
    // 打开弹窗时的同步重置属于请求路径必需状态，非级联渲染
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    staffApi<RevisionView[]>(path)
      .then((data) => setRevisions(data))
      .catch((err) =>
        setError(err instanceof Error ? err.message : "加载编辑历史失败"),
      )
      .finally(() => setLoading(false));
  }, [target]);

  // 关闭时的状态清理放在事件处理器（而非 effect 的同步 setState），避免级联渲染
  function handleClose() {
    setRevisions(null);
    setError(null);
    setLoading(false);
    onClose();
  }

  return (
    <Dialog open={Boolean(target)} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>编辑历史{target ? ` · ${target.label}` : ""}</DialogTitle>
      <DialogContent dividers>
        {loading ? (
          <Stack sx={{ alignItems: "center", py: 4 }}>
            <CircularProgress size={28} />
          </Stack>
        ) : error ? (
          <Typography color="error.main">{error}</Typography>
        ) : !revisions || revisions.length === 0 ? (
          <Typography color="text.secondary">暂无历史版本。</Typography>
        ) : (
          <Stack spacing={1}>
            <Typography variant="body2" color="text.secondary">
              共 {revisions.length} 个历史版本，点击任一版本展开查看当时全文。
            </Typography>
            {revisions.map((revision) => {
              const preview = truncatePlainText(
                htmlToPlainText(revision.body),
                60,
              );
              return (
                <Accordion
                  key={revision.id}
                  disableGutters
                  elevation={0}
                  defaultExpanded={revisions.length === 1}
                  sx={{
                    border: "1px solid",
                    borderColor: "divider",
                    borderRadius: 1,
                    "&:before": { display: "none" },
                    "&.Mui-expanded": { m: 0 },
                  }}
                >
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Stack spacing={0.25} sx={{ minWidth: 0, width: "100%" }}>
                      <Typography variant="body2" color="text.secondary">
                        {revision.editedByName} ·{" "}
                        {dateTimeFormatter.format(new Date(revision.editedAt))}
                        {revision.visibility === "INTERNAL" ? " · 内部" : ""}
                      </Typography>
                      {preview ? (
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {preview}
                        </Typography>
                      ) : null}
                    </Stack>
                  </AccordionSummary>
                  <AccordionDetails sx={{ pt: 0 }}>
                    {revision.title ? (
                      <Typography sx={{ fontWeight: 650, mb: 1 }}>
                        {revision.title}
                      </Typography>
                    ) : null}
                    <CollapsibleText text={revision.body} collapsible={false} />
                  </AccordionDetails>
                </Accordion>
              );
            })}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  );
}
