"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
} from "@mui/material";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";
import type {
  ProjectOption,
  ProjectStatus,
  StaffCandidate,
} from "@/components/staff/staff-types";

const statusOptions: Array<{ value: ProjectStatus; label: string }> = [
  { value: "DRAFT", label: "草稿" },
  { value: "ACTIVE", label: "进行中" },
  { value: "PAUSED", label: "已暂停" },
  { value: "COMPLETED", label: "已完成" },
  { value: "EXPIRED", label: "已到期" },
];

export function CreateProjectDialog({
  open,
  onClose,
  customerSpaces,
  serviceTypes,
  managerCandidates,
  currentUserId,
}: {
  open: boolean;
  onClose: () => void;
  customerSpaces: ProjectOption[];
  serviceTypes: ProjectOption[];
  managerCandidates: StaffCandidate[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [managerUserIds, setManagerUserIds] = useState<string[]>([
    currentUserId,
  ]);

  function handleClose() {
    if (submitting) return;
    setError("");
    setManagerUserIds([currentUserId]);
    onClose();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setSubmitting(true);
    setError("");
    try {
      const project = await staffApi<{ id: string }>(
        "/api/v1/projects",
        jsonRequest("POST", {
          title: String(formData.get("title") ?? "").trim(),
          description:
            String(formData.get("description") ?? "").trim() || null,
          status: String(formData.get("status") ?? "DRAFT"),
          currentStage:
            String(formData.get("currentStage") ?? "").trim() || null,
          customerSpaceId: String(formData.get("customerSpaceId") ?? ""),
          serviceTypeId: String(formData.get("serviceTypeId") ?? ""),
          startDate: formData.get("startDate")
            ? new Date(String(formData.get("startDate"))).toISOString()
            : null,
          endDate: formData.get("endDate")
            ? new Date(String(formData.get("endDate"))).toISOString()
            : null,
          managerUserIds:
            managerUserIds.length > 0 ? managerUserIds : [currentUserId],
        }),
      );
      setError("");
      setManagerUserIds([currentUserId]);
      onClose();
      router.push(`/staff/projects/${project.id}`);
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "项目创建失败",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      fullWidth
      maxWidth="sm"
    >
      <Box component="form" onSubmit={submit}>
        {submitting ? <LinearProgress /> : null}
        <DialogTitle>新建项目</DialogTitle>
        <DialogContent>
          <Stack spacing={2.25} sx={{ pt: 1 }}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            <TextField name="title" label="项目名称" required fullWidth />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                name="customerSpaceId"
                label="客户空间"
                select
                required
                fullWidth
                defaultValue=""
              >
                {customerSpaces.map((option) => (
                  <MenuItem key={option.id} value={option.id}>
                    {option.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                name="serviceTypeId"
                label="服务类型"
                select
                required
                fullWidth
                defaultValue=""
              >
                {serviceTypes.map((option) => (
                  <MenuItem key={option.id} value={option.id}>
                    {option.name}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
            <TextField
              select
              label="项目负责人"
              value={managerUserIds}
              onChange={(event) => {
                const value = event.target.value;
                setManagerUserIds(
                  typeof value === "string" ? value.split(",") : (value as string[]),
                );
              }}
              fullWidth
              slotProps={{
                select: {
                  multiple: true,
                  renderValue: (selected) => {
                    const ids = selected as string[];
                    if (ids.length === 0) return "默认：创建人";
                    return ids
                      .map((id) => {
                        const hit = managerCandidates.find((item) => item.id === id);
                        return hit ? hit.name : id;
                      })
                      .join("、");
                  },
                },
              }}
              helperText="创建时至少指定一位项目负责人；不选则默认创建人"
            >
              {managerCandidates.map((candidate) => (
                <MenuItem key={candidate.id} value={candidate.id}>
                  {candidate.name}
                  {candidate.id === currentUserId ? "（我）" : ""} ·{" "}
                  {candidate.platformRole === "PLATFORM_ADMIN"
                    ? "平台管理员"
                    : "项目负责人"}
                </MenuItem>
              ))}
            </TextField>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                name="status"
                label="初始状态"
                select
                fullWidth
                defaultValue="DRAFT"
              >
                {statusOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField name="currentStage" label="当前阶段" fullWidth />
            </Stack>
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
              label="项目说明"
              multiline
              minRows={3}
              fullWidth
              slotProps={{ htmlInput: { maxLength: 5000 } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={handleClose} disabled={submitting}>
            取消
          </Button>
          <Button type="submit" variant="contained" disabled={submitting}>
            {submitting ? "正在创建" : "创建项目"}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
