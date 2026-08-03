"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
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
  ToggleButton,
  ToggleButtonGroup,
} from "@mui/material";
import { DateStringPicker } from "@/components/shared/date-string-picker";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";
import type {
  ProjectOption,
  StaffCandidate,
} from "@/components/staff/staff-types";

const createProjectFormSchema = z
  .object({
    kind: z.enum(["STANDARD", "EXTERNAL_INTEGRATION"]),
    connectorPluginKey: z.string(),
    title: z.string().trim().min(1, "请填写项目名称").max(200),
    customerSpaceId: z.string(),
    serviceTypeId: z.string().min(1, "请选择服务类型"),
    managerUserIds: z.array(z.string()).max(20),
    startDate: z.string(),
    endDate: z.string(),
    description: z.string().trim().max(5000),
  })
  .superRefine((values, context) => {
    if (values.kind === "STANDARD" && !values.customerSpaceId) {
      context.addIssue({
        code: "custom",
        path: ["customerSpaceId"],
        message: "请选择客户",
      });
    }
    if (values.kind === "EXTERNAL_INTEGRATION" && !values.connectorPluginKey) {
      context.addIssue({
        code: "custom",
        path: ["connectorPluginKey"],
        message: "请选择外部连接器",
      });
    }
    if (
      values.startDate &&
      values.endDate &&
      values.endDate < values.startDate
    ) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "结束日期不能早于开始日期",
      });
    }
  });

type CreateProjectFormValues = z.infer<typeof createProjectFormSchema>;

export function CreateProjectDialog({
  open,
  onClose,
  customerSpaces,
  serviceTypes,
  managerCandidates,
  currentUserId,
  externalConnectors,
}: {
  open: boolean;
  onClose: () => void;
  customerSpaces: ProjectOption[];
  serviceTypes: ProjectOption[];
  managerCandidates: StaffCandidate[];
  currentUserId: string;
  externalConnectors: ProjectOption[];
}) {
  const router = useRouter();
  const initialValues: CreateProjectFormValues = {
    kind: "STANDARD",
    connectorPluginKey: externalConnectors[0]?.id ?? "",
    title: "",
    customerSpaceId: "",
    serviceTypeId: "",
    managerUserIds: [currentUserId],
    startDate: "",
    endDate: "",
    description: "",
  };
  const {
    control,
    handleSubmit,
    reset,
    clearErrors,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateProjectFormValues>({
    resolver: zodResolver(createProjectFormSchema),
    defaultValues: initialValues,
  });
  const kind = useWatch({ control, name: "kind" });
  const startDate = useWatch({ control, name: "startDate" });
  const endDate = useWatch({ control, name: "endDate" });

  function handleClose() {
    if (isSubmitting) return;
    reset(initialValues);
    onClose();
  }

  const submit = handleSubmit(async (values) => {
    clearErrors("root");
    try {
      const project = await staffApi<{ id: string }>(
        "/api/v1/projects",
        jsonRequest("POST", {
          title: values.title,
          kind: values.kind,
          description: values.description || null,
          customerSpaceId:
            values.kind === "STANDARD"
              ? values.customerSpaceId
              : undefined,
          connectorPluginKey:
            values.kind === "EXTERNAL_INTEGRATION"
              ? values.connectorPluginKey
              : undefined,
          serviceTypeId: values.serviceTypeId,
          startDate: values.startDate
            ? new Date(values.startDate).toISOString()
            : null,
          endDate: values.endDate
            ? new Date(values.endDate).toISOString()
            : null,
          managerUserIds:
            values.managerUserIds.length > 0
              ? values.managerUserIds
              : [currentUserId],
        }),
      );
      reset(initialValues);
      onClose();
      router.push(`/staff/projects/${project.id}`);
      router.refresh();
    } catch (submitError) {
      setError("root", {
        message:
          submitError instanceof Error ? submitError.message : "项目创建失败",
      });
    }
  });

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      fullWidth
      maxWidth="sm"
    >
      <Box component="form" onSubmit={submit}>
        {isSubmitting ? <LinearProgress /> : null}
        <DialogTitle>新建项目</DialogTitle>
        <DialogContent>
          <Stack spacing={2.25} sx={{ pt: 1 }}>
            {errors.root?.message ? <Alert severity="error">{errors.root.message}</Alert> : null}
            {externalConnectors.length > 0 ? (
              <Controller
                name="kind"
                control={control}
                render={({ field }) => (
                  <ToggleButtonGroup
                    exclusive
                    fullWidth
                    value={field.value}
                    onChange={(_, value) => {
                      if (value) field.onChange(value);
                    }}
                    aria-label="项目类型"
                  >
                    <ToggleButton value="STANDARD">标准项目</ToggleButton>
                    <ToggleButton value="EXTERNAL_INTEGRATION">
                      外部接入项目
                    </ToggleButton>
                  </ToggleButtonGroup>
                )}
              />
            ) : null}
            {kind === "EXTERNAL_INTEGRATION" ? (
              <Alert severity="info">
                无需选择客户。外部用户将由所选连接器验证，并作为独立联系人进入该项目。
              </Alert>
            ) : null}
            {kind === "EXTERNAL_INTEGRATION" ? (
              <Controller
                name="connectorPluginKey"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    select
                    label="外部连接器"
                    required
                    fullWidth
                    error={Boolean(errors.connectorPluginKey)}
                    helperText={errors.connectorPluginKey?.message}
                  >
                    {externalConnectors.map((connector) => (
                      <MenuItem key={connector.id} value={connector.id}>
                        {connector.name}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
            ) : null}
            <Controller
              name="title"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="项目名称"
                  required
                  fullWidth
                  error={Boolean(errors.title)}
                  helperText={errors.title?.message}
                />
              )}
            />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              {kind === "STANDARD" ? (
                <Controller
                  name="customerSpaceId"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="客户"
                      select
                      required
                      fullWidth
                      error={Boolean(errors.customerSpaceId)}
                      helperText={errors.customerSpaceId?.message}
                    >
                      {customerSpaces.map((option) => (
                        <MenuItem key={option.id} value={option.id}>
                          {option.name}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                />
              ) : null}
              <Controller
                name="serviceTypeId"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="服务类型"
                    select
                    required
                    fullWidth
                    error={Boolean(errors.serviceTypeId)}
                    helperText={errors.serviceTypeId?.message}
                  >
                    {serviceTypes.map((option) => (
                      <MenuItem key={option.id} value={option.id}>
                        {option.name}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
            </Stack>
            <Controller
              name="managerUserIds"
              control={control}
              render={({ field }) => (
                <TextField
                  select
                  label="项目负责人"
                  value={field.value}
                  onChange={(event) => {
                    const value = event.target.value;
                    field.onChange(
                      typeof value === "string"
                        ? value.split(",")
                        : (value as string[]),
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
                            const hit = managerCandidates.find(
                              (item) => item.id === id,
                            );
                            return hit ? hit.name : id;
                          })
                          .join("、");
                      },
                    },
                  }}
                  helperText="未选择时由创建人负责"
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
              )}
            />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <Controller
                name="startDate"
                control={control}
                render={({ field }) => (
                  <DateStringPicker
                    label="开始日期"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    name={field.name}
                    inputRef={field.ref}
                    maxDate={endDate}
                  />
                )}
              />
              <Controller
                name="endDate"
                control={control}
                render={({ field }) => (
                  <DateStringPicker
                    label="结束日期"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    name={field.name}
                    inputRef={field.ref}
                    minDate={startDate}
                    error={Boolean(errors.endDate)}
                    helperText={errors.endDate?.message}
                  />
                )}
              />
            </Stack>
            <Controller
              name="description"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="项目说明"
                  multiline
                  minRows={3}
                  fullWidth
                  error={Boolean(errors.description)}
                  helperText={errors.description?.message}
                  slotProps={{ htmlInput: { maxLength: 5000 } }}
                />
              )}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={handleClose} disabled={isSubmitting}>
            取消
          </Button>
          <Button type="submit" variant="contained" disabled={isSubmitting}>
            {isSubmitting ? "正在创建" : "创建项目"}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
