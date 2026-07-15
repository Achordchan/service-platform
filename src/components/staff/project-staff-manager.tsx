"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import PersonAddAltOutlinedIcon from "@mui/icons-material/PersonAddAltOutlined";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";
import type {
  ProjectStaffMember,
  StaffCandidate,
} from "@/components/staff/staff-types";

function roleLabel(role: StaffCandidate["platformRole"] | ProjectStaffMember["role"]) {
  if (role === "PLATFORM_ADMIN") return "平台管理员";
  if (role === "PROJECT_MANAGER") return "项目负责人";
  return "技术人员";
}

function defaultProjectRole(
  platformRole: StaffCandidate["platformRole"],
): ProjectStaffMember["role"] {
  return platformRole === "TECHNICIAN" ? "TECHNICIAN" : "PROJECT_MANAGER";
}

export function ProjectStaffManager({
  projectId,
  staff,
  candidates,
  canEdit,
}: {
  projectId: string;
  staff: ProjectStaffMember[];
  candidates: StaffCandidate[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [projectRole, setProjectRole] =
    useState<ProjectStaffMember["role"]>("PROJECT_MANAGER");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const availableCandidates = useMemo(() => {
    const assigned = new Set(staff.map((member) => member.userId));
    return candidates.filter((candidate) => !assigned.has(candidate.id));
  }, [candidates, staff]);

  const selectedCandidate = availableCandidates.find(
    (candidate) => candidate.id === selectedUserId,
  );

  function selectUser(userId: string) {
    setSelectedUserId(userId);
    const candidate = availableCandidates.find((item) => item.id === userId);
    if (candidate) {
      setProjectRole(defaultProjectRole(candidate.platformRole));
    }
  }

  async function addStaff() {
    if (!selectedCandidate) return;
    setSubmitting(true);
    setError("");
    try {
      await staffApi(
        `/api/v1/projects/${projectId}/staff`,
        jsonRequest("POST", {
          userId: selectedCandidate.id,
          role:
            selectedCandidate.platformRole === "TECHNICIAN"
              ? "TECHNICIAN"
              : projectRole,
        }),
      );
      setOpen(false);
      setSelectedUserId("");
      setProjectRole("PROJECT_MANAGER");
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "人员分配失败",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function removeStaff(projectStaffId: string) {
    setSubmitting(true);
    setError("");
    try {
      await staffApi(
        `/api/v1/projects/${projectId}/staff/${projectStaffId}`,
        { method: "DELETE" },
      );
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "移除失败",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Stack
        direction="row"
        spacing={2}
        sx={{ alignItems: "center", justifyContent: "space-between" }}
      >
        <Typography variant="h3">项目人员</Typography>
        {canEdit ? (
          <Button
            size="small"
            startIcon={<PersonAddAltOutlinedIcon />}
            onClick={() => {
              setError("");
              setOpen(true);
            }}
          >
            分配人员
          </Button>
        ) : null}
      </Stack>
      {error ? <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert> : null}
      <Stack spacing={2} sx={{ mt: 2 }}>
        {staff.map((member) => (
          <Stack
            key={member.id}
            direction="row"
            spacing={2}
            sx={{ alignItems: "center", justifyContent: "space-between" }}
          >
            <div>
              <Typography sx={{ fontWeight: 650 }}>{member.name}</Typography>
              <Typography variant="body2" color="text.secondary">
                {member.email}
              </Typography>
            </div>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Typography variant="body2" color="text.secondary">
                {roleLabel(member.role)}
              </Typography>
              {canEdit ? (
                <Button
                  size="small"
                  color="inherit"
                  disabled={submitting}
                  onClick={() => removeStaff(member.id)}
                >
                  移除
                </Button>
              ) : null}
            </Stack>
          </Stack>
        ))}
        {staff.length === 0 ? (
          <Typography color="text.secondary">尚未分配项目人员。</Typography>
        ) : null}
      </Stack>

      <Dialog
        open={open}
        onClose={submitting ? undefined : () => setOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>分配项目人员</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            <TextField
              select
              label="协作人员"
              value={selectedUserId}
              onChange={(event) => selectUser(event.target.value)}
              fullWidth
            >
              {availableCandidates.map((candidate) => (
                <MenuItem key={candidate.id} value={candidate.id}>
                  {candidate.name} · {roleLabel(candidate.platformRole)}
                </MenuItem>
              ))}
            </TextField>
            {selectedCandidate &&
            selectedCandidate.platformRole !== "TECHNICIAN" ? (
              <TextField
                select
                label="项目角色"
                value={projectRole}
                onChange={(event) =>
                  setProjectRole(
                    event.target.value as ProjectStaffMember["role"],
                  )
                }
                fullWidth
                helperText="平台管理员和项目负责人默认可担任项目负责人"
              >
                <MenuItem value="PROJECT_MANAGER">项目负责人</MenuItem>
                <MenuItem value="TECHNICIAN">技术人员</MenuItem>
              </TextField>
            ) : null}
            {availableCandidates.length === 0 ? (
              <Alert severity="info">
                暂无可分配人员，请先到「团队」邀请成员。
              </Alert>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={submitting}>
            取消
          </Button>
          <Button
            variant="contained"
            onClick={addStaff}
            disabled={!selectedCandidate || submitting}
          >
            确认分配
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
