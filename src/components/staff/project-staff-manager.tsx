"use client";

import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { z } from "zod";
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
import { DeliveryNotice } from "@/components/shared/delivery-notice";
import { useToast } from "@/components/shared/toast-provider";
import { deliveryOverridePayload } from "@/lib/delivery-notice";
import { useDeliveryChannelRule } from "@/hooks/use-delivery-channels";
import type { NotificationDeliveryOverride } from "@/modules/notifications/notification-delivery-override";
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

const projectStaffFormSchema = z.object({
  userId: z.string().min(1, "请选择协作人员"),
  projectRole: z.enum(["PROJECT_MANAGER", "TECHNICIAN"]),
});

type ProjectStaffFormValues = z.infer<typeof projectStaffFormSchema>;

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
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const form = useForm<ProjectStaffFormValues>({
    resolver: zodResolver(projectStaffFormSchema),
    defaultValues: {
      userId: "",
      projectRole: "PROJECT_MANAGER",
    },
    mode: "onChange",
  });
  const staffMutation = useMutation({
    mutationFn: (action: () => Promise<void>) => action(),
  });
  const submitting = staffMutation.isPending;

  const availableCandidates = useMemo(() => {
    const assigned = new Set(staff.map((member) => member.userId));
    return candidates.filter((candidate) => !assigned.has(candidate.id));
  }, [candidates, staff]);

  const selectedUserId = useWatch({
    control: form.control,
    name: "userId",
  });
  const selectedCandidate = availableCandidates.find(
    (candidate) => candidate.id === selectedUserId,
  );

  function selectUser(userId: string) {
    form.setValue("userId", userId, {
      shouldDirty: true,
      shouldValidate: true,
    });
    const candidate = availableCandidates.find((item) => item.id === userId);
    if (candidate) {
      form.setValue("projectRole", defaultProjectRole(candidate.platformRole), {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  }

  const [staffOverride, setStaffOverride] =
    useState<NotificationDeliveryOverride>({});
  // 覆盖是一次性的：关闭对话框的所有路径（取消、点遮罩）都要归零，
  // 否则自定义完再取消、下次给别人分配时会带着上次的强制/抑制设置提交
  const closeDialog = () => {
    setOpen(false);
    setStaffOverride({});
  };
  const staffDeliveryRule = useDeliveryChannelRule("PROJECT_STAFF");

  const addStaff = form.handleSubmit(async (values) => {
    const selectedCandidate = availableCandidates.find(
      (candidate) => candidate.id === values.userId,
    );
    if (!selectedCandidate) return;
    try {
      await staffMutation.mutateAsync(async () => {
        await staffApi(
          `/api/v1/projects/${projectId}/staff`,
          jsonRequest("POST", {
            userId: selectedCandidate.id,
            role:
              selectedCandidate.platformRole === "TECHNICIAN"
                ? "TECHNICIAN"
                : values.projectRole,
            ...deliveryOverridePayload(staffOverride, staffDeliveryRule),
          }),
        );
        setOpen(false);
        form.reset({ userId: "", projectRole: "PROJECT_MANAGER" });
        // 覆盖是一次性的，不跨下一次分配沿用
        setStaffOverride({});
        toast.success("项目人员已分配");
        router.refresh();
      });
    } catch (submitError) {
      toast.error(
        submitError instanceof Error ? submitError.message : "人员分配失败",
      );
    }
  });

  // 移出同样会给当事人发通知，所以和「分配人员」一样先看清会怎么提醒再确认
  const [pendingRemove, setPendingRemove] = useState<ProjectStaffMember | null>(
    null,
  );
  const [removeOverride, setRemoveOverride] =
    useState<NotificationDeliveryOverride>({});
  const closeRemoveDialog = () => {
    setPendingRemove(null);
    setRemoveOverride({});
  };

  async function removeStaff(member: ProjectStaffMember) {
    try {
      await staffMutation.mutateAsync(async () => {
        await staffApi(
          `/api/v1/projects/${projectId}/staff/${member.id}`,
          jsonRequest(
            "DELETE",
            deliveryOverridePayload(removeOverride, staffDeliveryRule),
          ),
        );
        closeRemoveDialog();
        toast.success("项目人员已移除，相关服务请求分配已同步清理");
        router.refresh();
      });
    } catch (submitError) {
      toast.error(
        submitError instanceof Error ? submitError.message : "移除失败",
      );
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
              form.reset({ userId: "", projectRole: "PROJECT_MANAGER" });
              setStaffOverride({});
              setOpen(true);
            }}
          >
            分配人员
          </Button>
        ) : null}
      </Stack>
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
                  onClick={() => {
                    setPendingRemove(member);
                    setRemoveOverride({});
                  }}
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
        onClose={submitting ? undefined : closeDialog}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>分配项目人员</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Controller
              name="userId"
              control={form.control}
              render={({ fieldState }) => (
                <TextField
                  select
                  label="协作人员"
                  value={selectedUserId}
                  onChange={(event) => selectUser(event.target.value)}
                  fullWidth
                  error={Boolean(fieldState.error)}
                  helperText={fieldState.error?.message}
                >
                  {availableCandidates.map((candidate) => (
                    <MenuItem key={candidate.id} value={candidate.id}>
                      {candidate.name} · {roleLabel(candidate.platformRole)}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            />
            {selectedCandidate &&
            selectedCandidate.platformRole !== "TECHNICIAN" ? (
              <Controller
                name="projectRole"
                control={form.control}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    select
                    label="项目角色"
                    fullWidth
                    error={Boolean(fieldState.error)}
                    helperText={
                      fieldState.error?.message ??
                      "平台管理员和项目负责人默认可担任项目负责人"
                    }
                  >
                    <MenuItem value="PROJECT_MANAGER">项目负责人</MenuItem>
                    <MenuItem value="TECHNICIAN">技术人员</MenuItem>
                  </TextField>
                )}
              />
            ) : null}
            {availableCandidates.length === 0 ? (
              <Alert severity="info">
                暂无可分配人员，请先到「团队」邀请成员。
              </Alert>
            ) : null}
            {selectedCandidate ? (
              <DeliveryNotice
                scene={{
                  scene: "PROJECT_STAFF",
                  projectId,
                  targetUserId: selectedCandidate.id,
                }}
                override={staffOverride}
                onOverrideChange={setStaffOverride}
                disabled={submitting}
              />
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog} disabled={submitting}>
            取消
          </Button>
          <Button
            variant="contained"
            onClick={() => void addStaff()}
            disabled={!selectedCandidate || submitting || !form.formState.isValid}
          >
            确认分配
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(pendingRemove)}
        onClose={submitting ? undefined : closeRemoveDialog}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>移出项目人员</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography>
              确定将「{pendingRemove?.name}」移出本项目吗？该成员在本项目下的服务请求分配会一并解除。
            </Typography>
            {pendingRemove ? (
              <DeliveryNotice
                scene={{
                  scene: "PROJECT_STAFF",
                  projectId,
                  targetUserId: pendingRemove.userId,
                }}
                override={removeOverride}
                onOverrideChange={setRemoveOverride}
                disabled={submitting}
              />
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeRemoveDialog} disabled={submitting}>
            取消
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={submitting}
            onClick={() => {
              if (pendingRemove) void removeStaff(pendingRemove);
            }}
          >
            确认移出
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
