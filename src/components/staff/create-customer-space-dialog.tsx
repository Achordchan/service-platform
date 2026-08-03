"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  TextField,
} from "@mui/material";
import ExpandMoreOutlinedIcon from "@mui/icons-material/ExpandMoreOutlined";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";

type CreatedCustomerSpace = {
  id: string;
  name: string;
  previewUrl?: string;
};

const createCustomerFormSchema = z.object({
  name: z.string().trim().min(1, "请填写客户名称").max(120),
  ownerName: z.string().trim().min(2, "负责人姓名至少需要 2 个字符").max(60),
  ownerEmail: z.email("请输入有效邮箱").trim().toLowerCase(),
  memberLimit: z.number().int().min(1).max(1000),
  slug: z
    .string()
    .trim()
    .max(80)
    .refine(
      (value) => !value || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value),
      "客户标识仅支持小写字母、数字和连字符",
    ),
});

type CreateCustomerFormValues = z.infer<typeof createCustomerFormSchema>;

function suggestSlug(name: string) {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return normalized;
}

export function CreateCustomerSpaceDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (result: CreatedCustomerSpace) => void;
}) {
  const {
    control,
    getFieldState,
    handleSubmit,
    setValue,
    setError,
    clearErrors,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateCustomerFormValues>({
    resolver: zodResolver(createCustomerFormSchema),
    defaultValues: {
      name: "",
      ownerName: "",
      ownerEmail: "",
      memberLimit: 2,
      slug: "",
    },
  });
  const name = useWatch({ control, name: "name" });
  const slug = useWatch({ control, name: "slug" });
  const suggestedSlug = useMemo(() => suggestSlug(name), [name]);

  async function submit(values: CreateCustomerFormValues) {
    clearErrors("root");
    try {
      const result = await staffApi<CreatedCustomerSpace>(
        "/api/v1/admin/customer-spaces",
        jsonRequest("POST", {
          ...values,
          slug: values.slug || undefined,
          status: "ACTIVE",
        }),
      );
      reset();
      onCreated(result);
    } catch (submitError) {
      setError("root", {
        message:
          submitError instanceof Error ? submitError.message : "客户创建失败",
      });
    }
  }

  return (
    <Dialog
      open={open}
      onClose={isSubmitting ? undefined : onClose}
      fullWidth
      maxWidth="sm"
    >
      <Box component="form" onSubmit={handleSubmit(submit)}>
        {isSubmitting ? <LinearProgress /> : null}
        <DialogTitle>新建客户</DialogTitle>
        <DialogContent>
          <Stack spacing={2.25} sx={{ pt: 1 }}>
            {errors.root?.message ? <Alert severity="error">{errors.root.message}</Alert> : null}
            <Controller
              name="name"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="客户名称"
                  placeholder="例如：远景科技"
                  required
                  fullWidth
                  error={Boolean(errors.name)}
                  helperText={errors.name?.message}
                  onChange={(event) => {
                    field.onChange(event);
                    if (!getFieldState("slug").isDirty) {
                      setValue("slug", suggestSlug(event.target.value), {
                        shouldValidate: true,
                      });
                    }
                  }}
                  slotProps={{ htmlInput: { maxLength: 120 } }}
                />
              )}
            />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <Controller
                name="ownerName"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="负责人姓名"
                    required
                    fullWidth
                    error={Boolean(errors.ownerName)}
                    helperText={errors.ownerName?.message}
                    slotProps={{ htmlInput: { minLength: 2, maxLength: 60 } }}
                  />
                )}
              />
              <Controller
                name="ownerEmail"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="负责人邮箱"
                    type="email"
                    autoComplete="off"
                    required
                    fullWidth
                    error={Boolean(errors.ownerEmail)}
                    helperText={errors.ownerEmail?.message}
                  />
                )}
              />
            </Stack>
            <Controller
              name="memberLimit"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="成员上限"
                  type="number"
                  required
                  fullWidth
                  error={Boolean(errors.memberLimit)}
                  helperText={errors.memberLimit?.message}
                  onChange={(event) => field.onChange(Number(event.target.value))}
                  slotProps={{ htmlInput: { min: 1, max: 1000 } }}
                />
              )}
            />
            <Accordion variant="outlined" disableGutters>
              <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
                高级设置
              </AccordionSummary>
              <AccordionDetails>
                <Controller
                  name="slug"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="客户标识"
                      placeholder="留空自动生成"
                      helperText={
                        errors.slug?.message ??
                        (slug || suggestedSlug
                          ? `当前标识：${(slug || suggestedSlug).toLowerCase()}`
                          : "仅支持小写字母、数字和连字符")
                      }
                      error={Boolean(errors.slug)}
                      fullWidth
                      onChange={(event) => {
                        field.onChange(event.target.value.toLowerCase());
                      }}
                      slotProps={{
                        htmlInput: {
                          minLength: 0,
                          maxLength: 80,
                          pattern: "([a-z0-9]+(?:-[a-z0-9]+)*)?",
                        },
                      }}
                    />
                  )}
                />
              </AccordionDetails>
            </Accordion>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={onClose} disabled={isSubmitting}>
            取消
          </Button>
          <Button type="submit" variant="contained" disabled={isSubmitting}>
            {isSubmitting ? "正在创建" : "创建客户"}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
