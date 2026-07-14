"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import ExpandMoreOutlinedIcon from "@mui/icons-material/ExpandMoreOutlined";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";
import type { ServiceTypeItem } from "@/components/staff/staff-types";

type DialogState =
  | { type: "service" }
  | { type: "category"; serviceType: ServiceTypeItem }
  | null;

export function ServiceTypeManager({
  serviceTypes,
}: {
  serviceTypes: ServiceTypeItem[];
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function execute(url: string, body: unknown) {
    setSubmitting(true);
    setError("");
    try {
      await staffApi(url, jsonRequest("POST", body));
      setDialog(null);
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "保存失败",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function createService(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await execute("/api/v1/admin/service-types", {
      key: String(data.get("key") ?? "").trim(),
      name: String(data.get("name") ?? "").trim(),
      description: String(data.get("description") ?? "").trim() || null,
      active: true,
    });
  }

  async function createCategory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (dialog?.type !== "category") return;
    const data = new FormData(event.currentTarget);
    await execute(
      `/api/v1/admin/service-types/${dialog.serviceType.id}/request-categories`,
      {
        name: String(data.get("name") ?? "").trim(),
        description: String(data.get("description") ?? "").trim() || null,
        active: true,
      },
    );
  }

  async function toggleService(serviceType: ServiceTypeItem) {
    setSubmitting(true);
    setError("");
    try {
      await staffApi(
        `/api/v1/admin/service-types/${serviceType.id}`,
        jsonRequest("PATCH", { active: !serviceType.active }),
      );
      router.refresh();
    } catch (toggleError) {
      setError(
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
    setError("");
    try {
      await staffApi(
        `/api/v1/admin/service-types/${serviceType.id}/request-categories/${category.id}`,
        jsonRequest("PATCH", { active: !category.active }),
      );
      router.refresh();
    } catch (toggleError) {
      setError(
        toggleError instanceof Error ? toggleError.message : "分类状态更新失败",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Stack spacing={2.5}>
      <Button
        variant="contained"
        startIcon={<AddOutlinedIcon />}
        onClick={() => setDialog({ type: "service" })}
        sx={{ alignSelf: { xs: "stretch", sm: "flex-end" } }}
      >
        新建服务类型
      </Button>
      {error ? <Alert severity="error">{error}</Alert> : null}
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
                  </Stack>
                ))}
                {serviceType.categories.length === 0 ? (
                  <Alert severity="info">该服务类型尚未配置请求分类。</Alert>
                ) : null}
              </Stack>
              <Button
                startIcon={<AddOutlinedIcon />}
                onClick={() => setDialog({ type: "category", serviceType })}
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
              {error ? <Alert severity="error">{error}</Alert> : null}
              <TextField name="name" label="服务类型名称" required />
              <TextField
                name="key"
                label="唯一标识"
                placeholder="例如 seo-service"
                helperText="仅支持小写字母、数字、连字符和下划线"
                required
              />
              <TextField
                name="description"
                label="服务说明"
                multiline
                minRows={3}
                slotProps={{ htmlInput: { maxLength: 1000 } }}
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
              {error ? <Alert severity="error">{error}</Alert> : null}
              <TextField name="name" label="分类名称" required />
              <TextField
                name="description"
                label="分类说明"
                multiline
                minRows={3}
                slotProps={{ htmlInput: { maxLength: 1000 } }}
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
    </Stack>
  );
}
