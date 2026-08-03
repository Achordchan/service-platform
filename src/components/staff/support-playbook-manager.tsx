"use client";

import { useCallback, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
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
import { useAppConfirm } from "@/components/shared/confirm-provider";
import { RichTextEditor } from "@/components/shared/rich-text-editor";
import { useToast } from "@/components/shared/toast-provider";
import {
  jsonRequest,
  staffApi,
  type ApiRequestOptions,
} from "@/components/staff/staff-api";
import {
  buildDefaultSupportReplyPlaybookContent,
  type SupportReplyPlaybookView,
} from "@/lib/support-reply-playbooks";
import { queryKeys } from "@/lib/query-keys";

const categoryLabels = {
  REMOTE: "远程协助",
  DIAGNOSTIC: "故障诊断",
  INFORMATION: "信息收集",
} as const;

type EditorState =
  | { mode: "create" }
  | { mode: "edit"; playbook: SupportReplyPlaybookView }
  | null;

function lines(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

const playbookFormSchema = z.object({
  category: z.enum(["REMOTE", "DIAGNOSTIC", "INFORMATION"]),
  title: z.string().trim().min(1, "请填写指南名称").max(120),
  content: z.string().trim().min(1, "请填写指南正文").max(50_000),
  safetyNotesText: z.string(),
  active: z.boolean(),
  sortOrder: z.number().int().min(-10_000).max(10_000),
});

type PlaybookFormValues = z.infer<typeof playbookFormSchema>;

export function SupportPlaybookManager({
  initialPlaybooks,
}: {
  initialPlaybooks: SupportReplyPlaybookView[];
}) {
  const confirm = useAppConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  const playbooksQuery = useQuery({
    queryKey: queryKeys.supportPlaybooks.admin,
    queryFn: ({ signal }) =>
      staffApi<SupportReplyPlaybookView[]>(
        "/api/v1/admin/support-playbooks",
        { signal },
      ),
    initialData: initialPlaybooks,
    staleTime: 30_000,
  });
  const actionMutation = useMutation({
    mutationFn: ({
      action,
    }: {
      key: string;
      action: () => Promise<SupportReplyPlaybookView[]>;
    }) => action(),
    onSuccess: (next) => {
      queryClient.setQueryData(queryKeys.supportPlaybooks.admin, next);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.supportPlaybooks.available,
      });
    },
  });
  const [editor, setEditor] = useState<EditorState>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [deletedOpen, setDeletedOpen] = useState(false);
  const busyKey = actionMutation.isPending
    ? (actionMutation.variables?.key ?? "action")
    : "";
  const playbooks = playbooksQuery.data ?? initialPlaybooks;
  const visiblePlaybooks = playbooks.filter((playbook) => !playbook.deletedAt);
  const deletedPlaybooks = playbooks.filter((playbook) => playbook.deletedAt);
  const form = useForm<PlaybookFormValues>({
    resolver: zodResolver(playbookFormSchema),
    defaultValues: {
      category: "INFORMATION",
      title: "",
      content: "",
      safetyNotesText: "",
      active: true,
      sortOrder: 10,
    },
  });

  const uploadImage = useCallback(async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const result = await staffApi<{ id: string }>(
      "/api/v1/admin/support-playbook-assets",
      { method: "POST", body: form },
    );
    return { attachmentId: result.id };
  }, []);

  function openCreate() {
    form.reset({
      category: "INFORMATION",
      title: "",
      content: "",
      safetyNotesText: "",
      active: true,
      sortOrder: (visiblePlaybooks.at(-1)?.sortOrder ?? 0) + 10,
    });
    setEditor({ mode: "create" });
  }

  function openEdit(playbook: SupportReplyPlaybookView) {
    form.reset({
      category: playbook.category,
      title: playbook.title,
      content:
        playbook.content || buildDefaultSupportReplyPlaybookContent(playbook),
      safetyNotesText: playbook.safetyNotes.join("\n"),
      active: playbook.active,
      sortOrder: playbook.sortOrder,
    });
    setEditor({ mode: "edit", playbook });
  }

  const submit = form.handleSubmit(async (values) => {
    if (!editor || imageUploading) return;
    const payload = {
      category: values.category,
      title: values.title,
      content: values.content,
      safetyNotes: lines(values.safetyNotesText),
      active: values.active,
      sortOrder: values.sortOrder,
    };
    const actionKey = editor.mode === "create" ? "create" : editor.playbook.key;
    try {
      await actionMutation.mutateAsync({
        key: actionKey,
        action: () =>
          staffApi<SupportReplyPlaybookView[]>(
          editor.mode === "create"
            ? "/api/v1/admin/support-playbooks"
            : `/api/v1/admin/support-playbooks/${encodeURIComponent(editor.playbook.key)}`,
          jsonRequest(editor.mode === "create" ? "POST" : "PATCH", payload),
          ),
      });
      setEditor(null);
      toast.success("回复指南已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "回复指南保存失败");
    }
  });

  async function updateState(playbook: SupportReplyPlaybookView) {
    await runAction(
      playbook.key,
      `/api/v1/admin/support-playbooks/${encodeURIComponent(playbook.key)}`,
      jsonRequest("PATCH", { active: !playbook.active }),
      "状态更新失败",
    );
  }

  async function reset(playbook: SupportReplyPlaybookView) {
    const confirmed = await confirm({
      title: "恢复系统默认内容？",
      description: `“${playbook.title}”的当前内容将被系统默认内容覆盖。`,
      confirmationText: "恢复默认",
      confirmationButtonProps: { color: "error", variant: "contained" },
    });
    if (!confirmed) return;
    await runAction(
      playbook.key,
      `/api/v1/admin/support-playbooks/${encodeURIComponent(playbook.key)}/reset`,
      jsonRequest("POST"),
      "恢复默认失败",
      "已恢复系统默认内容",
    );
  }

  async function remove(playbook: SupportReplyPlaybookView) {
    const confirmed = await confirm({
      title: `删除回复指南“${playbook.title}”？`,
      description: "指南将移入已删除列表，历史消息不会受影响。",
      confirmationText: "确认删除",
      confirmationButtonProps: { color: "error", variant: "contained" },
    });
    if (!confirmed) return;
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
    init: ApiRequestOptions,
    fallbackError: string,
    successText?: string,
  ) {
    try {
      await actionMutation.mutateAsync({
        key,
        action: () => staffApi<SupportReplyPlaybookView[]>(url, init),
      });
      if (successText) toast.success(successText);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : fallbackError);
    }
  }

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
      <Paper variant="outlined" sx={{ overflow: "hidden" }}>
        {playbooksQuery.error ? (
          <Alert
            severity="warning"
            action={
              <Button onClick={() => void playbooksQuery.refetch()}>
                重试
              </Button>
            }
          >
            回复指南刷新失败，当前仍显示最近一次数据。
          </Alert>
        ) : null}
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
          <Stack component="form" noValidate onSubmit={submit} sx={{ maxHeight: "min(860px, 94vh)" }}>
            {busyKey ? <LinearProgress /> : null}
            <DialogTitle>{editor.mode === "create" ? "新建回复指南" : "编辑回复指南"}</DialogTitle>
            <DialogContent dividers sx={{ overflowY: "auto" }}>
              <Stack spacing={2.25} sx={{ pt: 0.5 }}>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                  <Controller name="title" control={form.control} render={({ field }) => (
                    <TextField {...field} label="指南名称" required fullWidth error={Boolean(form.formState.errors.title)} helperText={form.formState.errors.title?.message} />
                  )} />
                  <Controller name="category" control={form.control} render={({ field }) => (
                    <TextField {...field} label="分类" select required sx={{ minWidth: { sm: 180 } }}>
                      {Object.entries(categoryLabels).map(([value, label]) => (
                        <MenuItem key={value} value={value}>{label}</MenuItem>
                      ))}
                    </TextField>
                  )} />
                </Stack>
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 0.75 }}>指南正文 *</Typography>
                  <Controller name="content" control={form.control} render={({ field }) => (
                    <RichTextEditor value={field.value} onChange={field.onChange} placeholder="输入客户需要查看的完整处理说明，可使用列表、链接和图片" minHeight={220} maxHeight={420} uploadImage={uploadImage} onImageUploadingChange={setImageUploading} />
                  )} />
                  {form.formState.errors.content?.message ? (
                    <Typography variant="caption" color="error">{form.formState.errors.content.message}</Typography>
                  ) : null}
                </Box>
                <Controller name="safetyNotesText" control={form.control} render={({ field }) => (
                  <TextField {...field} label="安全边界" helperText="每行一条；没有安全提示时可以留空" multiline minRows={3} />
                )} />
                <Accordion variant="outlined" disableGutters>
                  <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
                    <Typography sx={{ fontWeight: 650 }}>高级设置</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Stack spacing={2}>
                      <Controller name="sortOrder" control={form.control} render={({ field }) => (
                        <TextField {...field} label="排序值" type="number" onChange={(event) => field.onChange(Number(event.target.value))} error={Boolean(form.formState.errors.sortOrder)} helperText={form.formState.errors.sortOrder?.message ?? "数值越小越靠前"} required />
                      )} />
                      <Controller name="active" control={form.control} render={({ field }) => (
                        <FormControlLabel control={<Switch checked={field.value} onChange={(_, checked) => field.onChange(checked)} />} label="启用后允许后台人员发送" />
                      )} />
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
