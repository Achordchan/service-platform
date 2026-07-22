"use client";

import { useCallback, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import ExpandMoreOutlinedIcon from "@mui/icons-material/ExpandMoreOutlined";
import RestoreOutlinedIcon from "@mui/icons-material/RestoreOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import { RichTextEditor } from "@/components/shared/rich-text-editor";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";
import {
  buildDefaultSupportReplyPlaybookContent,
  type SupportReplyPlaybookView,
} from "@/lib/support-reply-playbooks";

const categoryLabels = {
  REMOTE: "远程协助",
  DIAGNOSTIC: "故障诊断",
  INFORMATION: "信息收集",
} as const;

type EditorState =
  | { mode: "create" }
  | { mode: "edit"; playbook: SupportReplyPlaybookView }
  | null;

function lines(value: FormDataEntryValue | null) {
  return String(value ?? "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function SupportPlaybookManager({
  initialPlaybooks,
}: {
  initialPlaybooks: SupportReplyPlaybookView[];
}) {
  const [playbooks, setPlaybooks] = useState(initialPlaybooks);
  const [editor, setEditor] = useState<EditorState>(null);
  const [editorContent, setEditorContent] = useState("");
  const [imageUploading, setImageUploading] = useState(false);
  const [deletedOpen, setDeletedOpen] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const visiblePlaybooks = playbooks.filter((playbook) => !playbook.deletedAt);
  const deletedPlaybooks = playbooks.filter((playbook) => playbook.deletedAt);

  const uploadImage = useCallback(async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch("/api/v1/admin/support-playbook-assets", {
      method: "POST",
      body: form,
    });
    const payload = (await response.json().catch(() => ({}))) as {
      data?: { id?: string };
      error?: { message?: string };
    };
    if (!response.ok || !payload.data?.id) {
      throw new Error(payload.error?.message || "图片上传失败");
    }
    return { attachmentId: payload.data.id };
  }, []);

  function openCreate() {
    setMessage(null);
    setEditorContent("");
    setEditor({ mode: "create" });
  }

  function openEdit(playbook: SupportReplyPlaybookView) {
    setMessage(null);
    setEditorContent(
      playbook.content || buildDefaultSupportReplyPlaybookContent(playbook),
    );
    setEditor({ mode: "edit", playbook });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || imageUploading) return;
    const form = new FormData(event.currentTarget);
    const payload = {
      category: String(form.get("category")),
      title: String(form.get("title") ?? "").trim(),
      content: editorContent,
      safetyNotes: lines(form.get("safetyNotes")),
      active: form.get("active") === "on",
      sortOrder: Number(form.get("sortOrder") ?? 0),
    };
    const actionKey = editor.mode === "create" ? "create" : editor.playbook.key;
    setBusyKey(actionKey);
    setMessage(null);
    try {
      setPlaybooks(
        await staffApi<SupportReplyPlaybookView[]>(
          editor.mode === "create"
            ? "/api/v1/admin/support-playbooks"
            : `/api/v1/admin/support-playbooks/${encodeURIComponent(editor.playbook.key)}`,
          jsonRequest(editor.mode === "create" ? "POST" : "PATCH", payload),
        ),
      );
      setEditor(null);
      setMessage({ type: "success", text: "回复指南已保存" });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "回复指南保存失败",
      });
    } finally {
      setBusyKey("");
    }
  }

  async function updateState(playbook: SupportReplyPlaybookView) {
    await runAction(
      playbook.key,
      `/api/v1/admin/support-playbooks/${encodeURIComponent(playbook.key)}`,
      jsonRequest("PATCH", { active: !playbook.active }),
      "状态更新失败",
    );
  }

  async function reset(playbook: SupportReplyPlaybookView) {
    if (!window.confirm(`确认将“${playbook.title}”恢复为系统默认内容？`)) return;
    await runAction(
      playbook.key,
      `/api/v1/admin/support-playbooks/${encodeURIComponent(playbook.key)}/reset`,
      jsonRequest("POST"),
      "恢复默认失败",
      "已恢复系统默认内容",
    );
  }

  async function remove(playbook: SupportReplyPlaybookView) {
    if (!window.confirm(`确认删除回复指南“${playbook.title}”？历史消息不会受影响。`)) return;
    await runAction(
      playbook.key,
      `/api/v1/admin/support-playbooks/${encodeURIComponent(playbook.key)}`,
      jsonRequest("DELETE"),
      "删除失败",
      "指南已移入已删除列表",
    );
  }

  async function restore(playbook: SupportReplyPlaybookView) {
    await runAction(
      playbook.key,
      `/api/v1/admin/support-playbooks/${encodeURIComponent(playbook.key)}/restore`,
      jsonRequest("POST"),
      "恢复失败",
      "指南已恢复并重新启用",
    );
  }

  async function runAction(
    key: string,
    url: string,
    init: RequestInit,
    fallbackError: string,
    successText?: string,
  ) {
    setBusyKey(key);
    setMessage(null);
    try {
      setPlaybooks(await staffApi<SupportReplyPlaybookView[]>(url, init));
      if (successText) setMessage({ type: "success", text: successText });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : fallbackError,
      });
    } finally {
      setBusyKey("");
    }
  }

  const editing = editor?.mode === "edit" ? editor.playbook : null;

  return (
    <Stack spacing={2.5}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{ justifyContent: "space-between", alignItems: { sm: "center" } }}
      >
        <Box>
          <Typography variant="h3">回复助手</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            管理后台人员可发送给客户的标准处理指南。
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          {deletedPlaybooks.length > 0 ? (
            <Button
              variant="outlined"
              startIcon={<Inventory2OutlinedIcon />}
              onClick={() => setDeletedOpen(true)}
            >
              已删除 {deletedPlaybooks.length}
            </Button>
          ) : null}
          <Button variant="contained" startIcon={<AddOutlinedIcon />} onClick={openCreate}>
            新建指南
          </Button>
        </Stack>
      </Stack>
      {message ? <Alert severity={message.type}>{message.text}</Alert> : null}
      <Paper variant="outlined" sx={{ overflow: "hidden" }}>
        {visiblePlaybooks.map((playbook, index) => (
          <Box key={playbook.key}>
            {index > 0 ? <Divider /> : null}
            <Stack
              direction={{ xs: "column", md: "row" }}
              spacing={2}
              sx={{ p: 2, alignItems: { md: "center" } }}
            >
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
                  <Typography sx={{ fontWeight: 700 }}>{playbook.title}</Typography>
                  <Chip size="small" variant="outlined" label={categoryLabels[playbook.category]} />
                  <Chip size="small" color={playbook.active ? "success" : "default"} label={playbook.active ? "启用" : "停用"} />
                  {playbook.isBuiltin ? <Chip size="small" variant="outlined" label="系统内置" /> : null}
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }} noWrap>
                  {playbook.summary}
                </Typography>
              </Box>
              <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", flexShrink: 0 }}>
                <Switch
                  checked={playbook.active}
                  onChange={() => void updateState(playbook)}
                  disabled={Boolean(busyKey)}
                  slotProps={{ input: { "aria-label": `${playbook.title}启用状态` } }}
                />
                <Tooltip title="编辑">
                  <IconButton onClick={() => openEdit(playbook)} disabled={Boolean(busyKey)}>
                    <EditOutlinedIcon />
                  </IconButton>
                </Tooltip>
                {playbook.isBuiltin ? (
                  <Tooltip title="恢复系统默认">
                    <IconButton onClick={() => void reset(playbook)} disabled={Boolean(busyKey)}>
                      <RestoreOutlinedIcon />
                    </IconButton>
                  </Tooltip>
                ) : null}
                <Tooltip title="删除">
                  <IconButton color="error" onClick={() => void remove(playbook)} disabled={Boolean(busyKey)}>
                    <DeleteOutlineOutlinedIcon />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Stack>
          </Box>
        ))}
        {visiblePlaybooks.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 6, textAlign: "center" }}>
            尚未配置回复指南
          </Typography>
        ) : null}
      </Paper>

      <Dialog open={Boolean(editor)} onClose={busyKey ? undefined : () => setEditor(null)} fullWidth maxWidth="md">
        {editor ? (
          <Stack component="form" onSubmit={submit} sx={{ maxHeight: "min(860px, 94vh)" }}>
            {busyKey ? <LinearProgress /> : null}
            <DialogTitle>{editor.mode === "create" ? "新建回复指南" : "编辑回复指南"}</DialogTitle>
            <DialogContent dividers sx={{ overflowY: "auto" }}>
              <Stack spacing={2.25} sx={{ pt: 0.5 }}>
                {message?.type === "error" ? <Alert severity="error">{message.text}</Alert> : null}
                <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                  <TextField name="title" label="指南名称" defaultValue={editing?.title ?? ""} required fullWidth />
                  <TextField name="category" label="分类" defaultValue={editing?.category ?? "INFORMATION"} select required sx={{ minWidth: { sm: 180 } }}>
                    {Object.entries(categoryLabels).map(([value, label]) => (
                      <MenuItem key={value} value={value}>{label}</MenuItem>
                    ))}
                  </TextField>
                </Stack>
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 0.75 }}>指南正文 *</Typography>
                  <RichTextEditor
                    value={editorContent}
                    onChange={setEditorContent}
                    placeholder="输入客户需要查看的完整处理说明，可使用列表、链接和图片"
                    minHeight={220}
                    maxHeight={420}
                    uploadImage={uploadImage}
                    onImageUploadingChange={setImageUploading}
                  />
                </Box>
                <TextField
                  name="safetyNotes"
                  label="安全边界"
                  helperText="每行一条；没有安全提示时可以留空"
                  defaultValue={editing?.safetyNotes.join("\n") ?? ""}
                  multiline
                  minRows={3}
                />
                <Accordion variant="outlined" disableGutters>
                  <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
                    <Typography sx={{ fontWeight: 650 }}>高级设置</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Stack spacing={2}>
                      <TextField
                        name="sortOrder"
                        label="排序值"
                        type="number"
                        defaultValue={editing?.sortOrder ?? (visiblePlaybooks.at(-1)?.sortOrder ?? 0) + 10}
                        helperText="数值越小越靠前"
                        required
                      />
                      <FormControlLabel
                        control={<Switch name="active" defaultChecked={editing?.active ?? true} />}
                        label="启用后允许后台人员发送"
                      />
                    </Stack>
                  </AccordionDetails>
                </Accordion>
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, py: 2 }}>
              <Button onClick={() => setEditor(null)} disabled={Boolean(busyKey)}>取消</Button>
              <Button type="submit" variant="contained" disabled={Boolean(busyKey) || imageUploading}>
                {imageUploading ? "图片上传中" : "保存"}
              </Button>
            </DialogActions>
          </Stack>
        ) : null}
      </Dialog>

      <Dialog open={deletedOpen} onClose={() => setDeletedOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>已删除的回复指南</DialogTitle>
        <DialogContent dividers>
          <Stack divider={<Divider flexItem />}>
            {deletedPlaybooks.map((playbook) => (
              <Stack key={playbook.key} direction="row" spacing={2} sx={{ py: 1.5, alignItems: "center" }}>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography sx={{ fontWeight: 650 }}>{playbook.title}</Typography>
                  <Typography variant="body2" color="text.secondary" noWrap>{playbook.summary}</Typography>
                </Box>
                <Tooltip title="恢复并启用">
                  <IconButton onClick={() => void restore(playbook)} disabled={Boolean(busyKey)}>
                    <RestoreOutlinedIcon />
                  </IconButton>
                </Tooltip>
              </Stack>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions><Button onClick={() => setDeletedOpen(false)}>关闭</Button></DialogActions>
      </Dialog>
    </Stack>
  );
}
