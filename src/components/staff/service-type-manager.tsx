"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
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
  LinearProgress,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import ExpandMoreOutlinedIcon from "@mui/icons-material/ExpandMoreOutlined";
import { DeletionPreflightDialog } from "@/components/shared/deletion-preflight-dialog";
import { useToast } from "@/components/shared/toast-provider";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";
import type { ServiceTypeItem } from "@/components/staff/staff-types";

type DialogState =
  | { type: "service" }
  | { type: "category"; serviceType: ServiceTypeItem }
  | null;

type DeleteTarget = {
  resourceType: "SERVICE_TYPE" | "REQUEST_CATEGORY";
  resourceId: string;
  resourceLabel: string;
  deleteUrl: string;
};

const serviceCreateFormSchema = z.object({
  key: z.string().trim().min(2).max(50).regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/, "唯一标识格式不正确"),
  name: z.string().trim().min(1, "请填写服务类型名称").max(100),
  description: z.string().trim().max(1000),
});
const editableTypeFormSchema = z.object({
  name: z.string().trim().min(1, "请填写名称").max(100),
  description: z.string().trim().max(1000),
  active: z.boolean(),
});

type ServiceCreateFormValues = z.infer<typeof serviceCreateFormSchema>;
type EditableTypeFormValues = z.infer<typeof editableTypeFormSchema>;

export function ServiceTypeManager({
  serviceTypes,
}: {
  serviceTypes: ServiceTypeItem[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [editingService, setEditingService] = useState<ServiceTypeItem | null>(null);
  const [editingCategory, setEditingCategory] = useState<{
    serviceType: ServiceTypeItem;
    category: ServiceTypeItem["categories"][number];
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const createServiceForm = useForm<ServiceCreateFormValues>({
    resolver: zodResolver(serviceCreateFormSchema),
    defaultValues: { key: "", name: "", description: "" },
  });
  const createCategoryForm = useForm<EditableTypeFormValues>({
    resolver: zodResolver(editableTypeFormSchema),
    defaultValues: { name: "", description: "", active: true },
  });
  const editServiceForm = useForm<EditableTypeFormValues>({
    resolver: zodResolver(editableTypeFormSchema),
    defaultValues: { name: "", description: "", active: true },
  });
  const editCategoryForm = useForm<EditableTypeFormValues>({
    resolver: zodResolver(editableTypeFormSchema),
    defaultValues: { name: "", description: "", active: true },
  });

  async function execute(
    url: string,
    method: "POST" | "PATCH",
    body?: unknown,
    successMessage = "保存成功",
  ) {
    setSubmitting(true);
    try {
      await staffApi(url, jsonRequest(method, body));
      setDialog(null);
      setEditingService(null);
      setEditingCategory(null);
      toast.success(successMessage);
      router.refresh();
    } catch (submitError) {
      toast.error(
        submitError instanceof Error ? submitError.message : "保存失败",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const createService = createServiceForm.handleSubmit(async (values) => {
    await execute(
      "/api/v1/admin/service-types",
      "POST",
      { ...values, description: values.description || null, active: true },
      "服务类型已创建",
    );
  });

  const createCategory = createCategoryForm.handleSubmit(async (values) => {
    if (dialog?.type !== "category") return;
    await execute(
      `/api/v1/admin/service-types/${dialog.serviceType.id}/request-categories`,
      "POST",
      { ...values, description: values.description || null, active: true },
      "请求分类已创建",
    );
  });

  async function toggleService(serviceType: ServiceTypeItem) {
    setSubmitting(true);
    try {
      await staffApi(
        `/api/v1/admin/service-types/${serviceType.id}`,
        jsonRequest("PATCH", { active: !serviceType.active }),
      );
      toast.success(serviceType.active ? "服务类型已停用" : "服务类型已启用");
      router.refresh();
    } catch (toggleError) {
      toast.error(
        toggleError instanceof Error ? toggleError.message : "状态更新失败",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleCategory(
    serviceType: ServiceTypeItem,
    category: ServiceTypeItem["categories"][number],
  ) {
    setSubmitting(true);
    try {
      await staffApi(
        `/api/v1/admin/service-types/${serviceType.id}/request-categories/${category.id}`,
        jsonRequest("PATCH", { active: !category.active }),
      );
      toast.success(category.active ? "请求分类已停用" : "请求分类已启用");
      router.refresh();
    } catch (toggleError) {
      toast.error(
        toggleError instanceof Error ? toggleError.message : "分类状态更新失败",
      );
    } finally {
      setSubmitting(false);
    }
  }


  const updateService = editServiceForm.handleSubmit(async (values) => {
    if (!editingService) return;
    await execute(
      `/api/v1/admin/service-types/${editingService.id}`,
      "PATCH",
      { ...values, description: values.description || null },
      "服务类型已更新",
    );
  });

  const updateCategory = editCategoryForm.handleSubmit(async (values) => {
    if (!editingCategory) return;
    await execute(
      `/api/v1/admin/service-types/${editingCategory.serviceType.id}/request-categories/${editingCategory.category.id}`,
      "PATCH",
      { ...values, description: values.description || null },
      "请求分类已更新",
    );
  });

  function openCreateService() {
    createServiceForm.reset();
    setDialog({ type: "service" });
  }

  function openCreateCategory(serviceType: ServiceTypeItem) {
    createCategoryForm.reset({ name: "", description: "", active: true });
    setDialog({ type: "category", serviceType });
  }

  function openEditService(serviceType: ServiceTypeItem) {
    editServiceForm.reset({
      name: serviceType.name,
      description: serviceType.description || "",
      active: serviceType.active,
    });
    setEditingService(serviceType);
  }

  function openEditCategory(
    serviceType: ServiceTypeItem,
    category: ServiceTypeItem["categories"][number],
  ) {
    editCategoryForm.reset({
      name: category.name,
      description: category.description || "",
      active: category.active,
    });
    setEditingCategory({ serviceType, category });
  }

  function removeService(serviceType: ServiceTypeItem) {
    setDeleteTarget({
      resourceType: "SERVICE_TYPE",
      resourceId: serviceType.id,
      resourceLabel: serviceType.name,
      deleteUrl: `/api/v1/admin/service-types/${serviceType.id}`,
    });
  }

  function removeCategory(
    serviceType: ServiceTypeItem,
    category: ServiceTypeItem["categories"][number],
  ) {
    setDeleteTarget({
      resourceType: "REQUEST_CATEGORY",
      resourceId: category.id,
      resourceLabel: category.name,
      deleteUrl: `/api/v1/admin/service-types/${serviceType.id}/request-categories/${category.id}`,
    });
  }

  return (
    <Stack spacing={2.5}>
      <Button
        variant="contained"
        startIcon={<AddOutlinedIcon />}
        onClick={openCreateService}
        sx={{ alignSelf: { xs: "stretch", sm: "flex-end" } }}
      >
        新建服务类型
      </Button>
      {submitting ? <LinearProgress /> : null}
      <Stack spacing={1.5}>
        {serviceTypes.map((serviceType) => (
          <Accordion key={serviceType.id} variant="outlined" disableGutters>
            <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1.5}
                sx={{
                  width: "100%",
                  pr: 1,
                  alignItems: { sm: "center" },
                  justifyContent: "space-between",
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <Typography sx={{ fontWeight: 650 }}>{serviceType.name}</Typography>
                    <Chip
                      label={serviceType.active ? "启用" : "停用"}
                      color={serviceType.active ? "success" : "default"}
                      size="small"
                      variant="outlined"
                    />
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {serviceType.key} · {serviceType.categories.length} 个请求分类
                  </Typography>
                </Box>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{
                    display: { xs: "none", md: "block" },
                    maxWidth: 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {serviceType.description || "未填写服务说明"}
                </Typography>
              </Stack>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
              <Divider sx={{ mb: 2 }} />
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1.5}
                sx={{ justifyContent: "space-between", mb: 2 }}
              >
                <Typography color="text.secondary">
                  {serviceType.description || "未填写服务说明"}
                </Typography>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={serviceType.active}
                        onChange={() => toggleService(serviceType)}
                        disabled={submitting}
                      />
                    }
                    label="启用服务"
                  />
                  <Button
                    size="small"
                    startIcon={<EditOutlinedIcon />}
                    onClick={() => openEditService(serviceType)}
                  >
                    编辑
                  </Button>
                  <Button
                    size="small"
                    color="inherit"
                    startIcon={<DeleteOutlinedIcon />}
                    disabled={submitting}
                    onClick={() => removeService(serviceType)}
                  >
                    删除
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AddOutlinedIcon />}
                    onClick={() => openCreateCategory(serviceType)}
                  >
                    新增分类
                  </Button>
                </Stack>
              </Stack>
              <Stack spacing={1}>
                {serviceType.categories.map((category) => (
                  <Stack
                    key={category.id}
                    direction={{ xs: "column", sm: "row" }}
                    spacing={1.5}
                    sx={{
                      p: 1.5,
                      border: "1px solid",
                      borderColor: "divider",
                      borderRadius: 1.5,
                      alignItems: { sm: "center" },
                      justifyContent: "space-between",
                    }}
                  >
                    <Box>
                      <Typography sx={{ fontWeight: 600 }}>{category.name}</Typography>
                      {category.description ? (
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>
                          {category.description}
                        </Typography>
                      ) : null}
                    </Box>
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={category.active}
                            onChange={() => toggleCategory(serviceType, category)}
                            disabled={submitting}
                          />
                        }
                        label={category.active ? "启用" : "停用"}
                      />
                      <Button
                        size="small"
                        startIcon={<EditOutlinedIcon />}
                        onClick={() =>
                          openEditCategory(serviceType, category)
                        }
                      >
                        编辑
                      </Button>
                      <Button
                        size="small"
                        color="inherit"
                        startIcon={<DeleteOutlinedIcon />}
                        disabled={submitting}
                        onClick={() => removeCategory(serviceType, category)}
                      >
                        删除
                      </Button>
                    </Stack>
                  </Stack>
                ))}
                {serviceType.categories.length === 0 ? (
                  <Alert severity="info">该服务类型尚未配置请求分类。</Alert>
                ) : null}
              </Stack>
              <Button
                startIcon={<AddOutlinedIcon />}
                onClick={() => openCreateCategory(serviceType)}
                sx={{ mt: 2 }}
              >
                新增请求分类
              </Button>
            </AccordionDetails>
          </Accordion>
        ))}
        {serviceTypes.length === 0 ? (
          <Alert severity="info">尚未创建服务类型。</Alert>
        ) : null}
      </Stack>

      <Dialog
        open={dialog?.type === "service"}
        onClose={submitting ? undefined : () => setDialog(null)}
        fullWidth
        maxWidth="sm"
      >
        <Stack component="form" onSubmit={createService}>
          {submitting ? <LinearProgress /> : null}
          <DialogTitle>新建服务类型</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Controller
                name="name"
                control={createServiceForm.control}
                render={({ field }) => (
                  <TextField {...field} label="服务类型名称" required error={Boolean(createServiceForm.formState.errors.name)} helperText={createServiceForm.formState.errors.name?.message} />
                )}
              />
              <Controller
                name="key"
                control={createServiceForm.control}
                render={({ field }) => (
                  <TextField {...field} label="唯一标识" placeholder="例如 seo-service" required error={Boolean(createServiceForm.formState.errors.key)} helperText={createServiceForm.formState.errors.key?.message ?? "仅支持小写字母、数字、连字符和下划线"} />
                )}
              />
              <Controller
                name="description"
                control={createServiceForm.control}
                render={({ field }) => (
                  <TextField {...field} label="服务说明" multiline minRows={3} error={Boolean(createServiceForm.formState.errors.description)} helperText={createServiceForm.formState.errors.description?.message} slotProps={{ htmlInput: { maxLength: 1000 } }} />
                )}
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 3 }}>
            <Button onClick={() => setDialog(null)} disabled={submitting}>
              取消
            </Button>
            <Button type="submit" variant="contained" disabled={submitting}>
              创建
            </Button>
          </DialogActions>
        </Stack>
      </Dialog>

      <Dialog
        open={dialog?.type === "category"}
        onClose={submitting ? undefined : () => setDialog(null)}
        fullWidth
        maxWidth="sm"
      >
        <Stack component="form" onSubmit={createCategory}>
          {submitting ? <LinearProgress /> : null}
          <DialogTitle>
            新增请求分类
            {dialog?.type === "category" ? ` · ${dialog.serviceType.name}` : ""}
          </DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Controller
                name="name"
                control={createCategoryForm.control}
                render={({ field }) => (
                  <TextField {...field} label="分类名称" required error={Boolean(createCategoryForm.formState.errors.name)} helperText={createCategoryForm.formState.errors.name?.message} />
                )}
              />
              <Controller
                name="description"
                control={createCategoryForm.control}
                render={({ field }) => (
                  <TextField {...field} label="分类说明" multiline minRows={3} error={Boolean(createCategoryForm.formState.errors.description)} helperText={createCategoryForm.formState.errors.description?.message} slotProps={{ htmlInput: { maxLength: 1000 } }} />
                )}
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 3 }}>
            <Button onClick={() => setDialog(null)} disabled={submitting}>
              取消
            </Button>
            <Button type="submit" variant="contained" disabled={submitting}>
              创建
            </Button>
          </DialogActions>
        </Stack>
      </Dialog>

      <Dialog
        open={Boolean(editingService)}
        onClose={submitting ? undefined : () => setEditingService(null)}
        fullWidth
        maxWidth="sm"
      >
        {editingService ? (
          <Stack component="form" onSubmit={updateService}>
            <DialogTitle>编辑服务类型</DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ pt: 1 }}>
                <Controller
                  name="name"
                  control={editServiceForm.control}
                  render={({ field }) => (
                    <TextField {...field} label="名称" required error={Boolean(editServiceForm.formState.errors.name)} helperText={editServiceForm.formState.errors.name?.message} />
                  )}
                />
                <Controller
                  name="description"
                  control={editServiceForm.control}
                  render={({ field }) => (
                    <TextField {...field} label="说明" multiline minRows={2} error={Boolean(editServiceForm.formState.errors.description)} helperText={editServiceForm.formState.errors.description?.message} />
                  )}
                />
                <Controller
                  name="active"
                  control={editServiceForm.control}
                  render={({ field }) => (
                    <FormControlLabel control={<Switch checked={field.value} onChange={(_, checked) => field.onChange(checked)} />} label="启用服务" />
                  )}
                />
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 3 }}>
              <Button onClick={() => setEditingService(null)} disabled={submitting}>
                取消
              </Button>
              <Button type="submit" variant="contained" disabled={submitting}>
                保存
              </Button>
            </DialogActions>
          </Stack>
        ) : null}
      </Dialog>

      <Dialog
        open={Boolean(editingCategory)}
        onClose={submitting ? undefined : () => setEditingCategory(null)}
        fullWidth
        maxWidth="sm"
      >
        {editingCategory ? (
          <Stack component="form" onSubmit={updateCategory}>
            <DialogTitle>编辑请求分类</DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ pt: 1 }}>
                <Controller
                  name="name"
                  control={editCategoryForm.control}
                  render={({ field }) => (
                    <TextField {...field} label="分类名称" required error={Boolean(editCategoryForm.formState.errors.name)} helperText={editCategoryForm.formState.errors.name?.message} />
                  )}
                />
                <Controller
                  name="description"
                  control={editCategoryForm.control}
                  render={({ field }) => (
                    <TextField {...field} label="说明" multiline minRows={2} error={Boolean(editCategoryForm.formState.errors.description)} helperText={editCategoryForm.formState.errors.description?.message} />
                  )}
                />
                <Controller
                  name="active"
                  control={editCategoryForm.control}
                  render={({ field }) => (
                    <FormControlLabel control={<Switch checked={field.value} onChange={(_, checked) => field.onChange(checked)} />} label="启用分类" />
                  )}
                />
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 3 }}>
              <Button onClick={() => setEditingCategory(null)} disabled={submitting}>
                取消
              </Button>
              <Button type="submit" variant="contained" disabled={submitting}>
                保存
              </Button>
            </DialogActions>
          </Stack>
        ) : null}
      </Dialog>
      <DeletionPreflightDialog
        target={
          deleteTarget
            ? {
                resourceType: deleteTarget.resourceType,
                resourceId: deleteTarget.resourceId,
                resourceLabel: deleteTarget.resourceLabel,
              }
            : null
        }
        deleteUrl={deleteTarget?.deleteUrl ?? null}
        onClose={() => setDeleteTarget(null)}
        onDeleted={() => {
          toast.success(
            deleteTarget?.resourceType === "SERVICE_TYPE"
              ? "服务类型已删除"
              : "请求分类已删除",
          );
          setDeleteTarget(null);
          router.refresh();
        }}
      />
    </Stack>
  );
}
