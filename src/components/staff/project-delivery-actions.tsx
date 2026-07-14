"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Stack,
  Switch,
  TextField,
} from "@mui/material";
import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import CampaignOutlinedIcon from "@mui/icons-material/CampaignOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";
import type {
  ProjectDetail,
  ProjectStatus,
} from "@/components/staff/staff-types";

type DialogName = "milestone" | "update" | "project" | null;

const projectStatusOptions: Array<{ value: ProjectStatus; label: string }> = [
  { value: "DRAFT", label: "草稿" },
  { value: "ACTIVE", label: "进行中" },
  { value: "PAUSED", label: "已暂停" },
  { value: "COMPLETED", label: "已完成" },
  { value: "EXPIRED", label: "已到期" },
];

function dateInput(value?: string | null) {
  return value ? value.slice(0, 10) : "";
}

export function ProjectDeliveryActions({
  project,
  canManage,
  canEditProject,
}: {
  project: ProjectDetail;
  canManage: boolean;
  canEditProject: boolean;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogName>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [showProgress, setShowProgress] = useState(project.showProgress !== false);
  const [showMilestones, setShowMilestones] = useState(
    project.showMilestones !== false,
  );

  async function execute(url: string, body: unknown) {
    setSubmitting(true);
    setError("");
    try {
      await staffApi(url, jsonRequest("POST", body));
      setDialog(null);
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "操作失败",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function submitMilestone(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await execute(`/api/v1/projects/${project.id}/milestones`, {
      title: String(data.get("title") ?? "").trim(),
      description: String(data.get("description") ?? "").trim() || null,
      status: String(data.get("status") ?? "NOT_STARTED"),
      startDate: data.get("startDate")
        ? new Date(String(data.get("startDate"))).toISOString()
        : null,
      endDate: data.get("endDate")
        ? new Date(String(data.get("endDate"))).toISOString()
        : null,
      sortOrder: project.milestones.length,
    });
  }

  async function submitUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await execute(`/api/v1/projects/${project.id}/updates`, {
      title: String(data.get("title") ?? "").trim(),
      body: String(data.get("body") ?? "").trim(),
      visibility: data.get("internal") ? "INTERNAL" : "CUSTOMER_VISIBLE",
    });
  }

  async function submitProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSubmitting(true);
    setError("");
    try {
      await staffApi(
        `/api/v1/projects/${project.id}`,
        jsonRequest("PATCH", {
          title: String(data.get("title") ?? "").trim(),
          description: String(data.get("description") ?? "").trim() || null,
          status: String(data.get("status") ?? project.status),
          currentStage:
            String(data.get("currentStage") ?? "").trim() || null,
          showMilestones,
          showProgress,
          startDate: data.get("startDate")
            ? new Date(String(data.get("startDate"))).toISOString()
            : null,
          endDate: data.get("endDate")
            ? new Date(String(data.get("endDate"))).toISOString()
            : null,
        }),
      );
      setDialog(null);
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "项目更新失败",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!canManage && !canEditProject) return null;

  return (
    <>
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{
          flexWrap: "wrap",
          justifyContent: { xs: "stretch", md: "flex-end" },
          width: "100%",
          "& > *": { flex: { xs: "1 1 auto", sm: "0 0 auto" } },
        }}
      >
        {canManage ? (
          <>
            <Button
              variant="contained"
              startIcon={<CampaignOutlinedIcon />}
              onClick={() => setDialog("update")}
            >
              发布进度
            </Button>
            {project.showMilestones !== false ? (
              <Button
                variant="outlined"
                startIcon={<AddOutlinedIcon />}
                onClick={() => setDialog("milestone")}
              >
                新增里程碑
              </Button>
            ) : null}
          </>
        ) : null}
        {canEditProject ? (
          <Button
            variant="outlined"
            color="inherit"
            startIcon={<SettingsOutlinedIcon />}
            onClick={() => {
              setShowProgress(project.showProgress !== false);
              setShowMilestones(project.showMilestones !== false);
              setDialog("project");
            }}
          >
            项目设置
          </Button>
        ) : null}
      </Stack>

      <Dialog
        open={dialog === "milestone"}
        onClose={submitting ? undefined : () => setDialog(null)}
        fullWidth
        maxWidth="sm"
      >
        <Stack component="form" onSubmit={submitMilestone}>
          {submitting ? <LinearProgress /> : null}
          <DialogTitle>新增里程碑</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              {error ? <Alert severity="error">{error}</Alert> : null}
              <TextField name="title" label="里程碑名称" required />
              <TextField
                name="status"
                label="状态"
                select
                defaultValue="NOT_STARTED"
              >
                <MenuItem value="NOT_STARTED">未开始</MenuItem>
                <MenuItem value="IN_PROGRESS">进行中</MenuItem>
                <MenuItem value="COMPLETED">已完成</MenuItem>
              </TextField>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  name="startDate"
                  label="开始日期"
                  type="date"
                  fullWidth
                  slotProps={{ inputLabel: { shrink: true } }}
                />
                <TextField
                  name="endDate"
                  label="结束日期"
                  type="date"
                  fullWidth
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              </Stack>
              <TextField
                name="description"
                label="说明"
                multiline
                minRows={3}
                slotProps={{ htmlInput: { maxLength: 3000 } }}
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 3 }}>
            <Button onClick={() => setDialog(null)} disabled={submitting}>
              取消
            </Button>
            <Button type="submit" variant="contained" disabled={submitting}>
              保存
            </Button>
          </DialogActions>
        </Stack>
      </Dialog>

      <Dialog
        open={dialog === "update"}
        onClose={submitting ? undefined : () => setDialog(null)}
        fullWidth
        maxWidth="sm"
      >
        <Stack component="form" onSubmit={submitUpdate}>
          {submitting ? <LinearProgress /> : null}
          <DialogTitle>发布项目进度</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              {error ? <Alert severity="error">{error}</Alert> : null}
              <TextField name="title" label="动态标题" required />
              <TextField
                name="body"
                label="进度说明"
                required
                multiline
                minRows={5}
                slotProps={{ htmlInput: { maxLength: 20000 } }}
              />
              <FormControlLabel
                control={<Switch name="internal" />}
                label="仅内部可见"
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 3 }}>
            <Button onClick={() => setDialog(null)} disabled={submitting}>
              取消
            </Button>
            <Button type="submit" variant="contained" disabled={submitting}>
              发布
            </Button>
          </DialogActions>
        </Stack>
      </Dialog>

      <Dialog
        open={dialog === "project"}
        onClose={submitting ? undefined : () => setDialog(null)}
        fullWidth
        maxWidth="sm"
      >
        <Stack component="form" onSubmit={submitProject}>
          {submitting ? <LinearProgress /> : null}
          <DialogTitle>项目设置</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              {error ? <Alert severity="error">{error}</Alert> : null}
              <TextField name="title" label="项目名称" defaultValue={project.title} required />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  name="status"
                  label="项目状态"
                  select
                  defaultValue={project.status}
                  fullWidth
                >
                  {projectStatusOptions.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  name="currentStage"
                  label="当前阶段"
                  defaultValue={project.currentStage ?? ""}
                  fullWidth
                />
              </Stack>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  name="startDate"
                  label="开始日期"
                  type="date"
                  defaultValue={dateInput(project.startDate)}
                  fullWidth
                  slotProps={{ inputLabel: { shrink: true } }}
                />
                <TextField
                  name="endDate"
                  label="结束日期"
                  type="date"
                  defaultValue={dateInput(project.endDate)}
                  fullWidth
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              </Stack>
              <TextField
                name="description"
                label="项目说明"
                defaultValue={project.description ?? ""}
                multiline
                minRows={3}
                slotProps={{ htmlInput: { maxLength: 5000 } }}
              />
              <Stack spacing={0.5}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={showProgress}
                      onChange={(event) => setShowProgress(event.target.checked)}
                    />
                  }
                  label="显示整体进度条"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={showMilestones}
                      onChange={(event) =>
                        setShowMilestones(event.target.checked)
                      }
                    />
                  }
                  label="显示里程碑模块"
                />
              </Stack>
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 3 }}>
            <Button onClick={() => setDialog(null)} disabled={submitting}>
              取消
            </Button>
            <Button type="submit" variant="contained" disabled={submitting}>
              保存
            </Button>
          </DialogActions>
        </Stack>
      </Dialog>
    </>
  );
}
