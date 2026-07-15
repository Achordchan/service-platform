"use client";

import { useMemo, useState } from "react";
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const suggestedSlug = useMemo(() => suggestSlug(name), [name]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setSubmitting(true);
    setError("");
    try {
      const result = await staffApi<CreatedCustomerSpace>(
        "/api/v1/admin/customer-spaces",
        jsonRequest("POST", {
          name: String(formData.get("name") ?? "").trim(),
          slug: String(formData.get("slug") ?? "").trim().toLowerCase() || undefined,
          ownerName: String(formData.get("ownerName") ?? "").trim(),
          ownerEmail: String(formData.get("ownerEmail") ?? "")
            .trim()
            .toLowerCase(),
          memberLimit: Number(formData.get("memberLimit")),
          status: "ACTIVE",
        }),
      );
      form.reset();
      setName("");
      setSlug("");
      setSlugTouched(false);
      onCreated(result);
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "客户创建失败",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={submitting ? undefined : onClose}
      fullWidth
      maxWidth="sm"
    >
      <Box component="form" onSubmit={submit}>
        {submitting ? <LinearProgress /> : null}
        <DialogTitle>新建客户</DialogTitle>
        <DialogContent>
          <Stack spacing={2.25} sx={{ pt: 1 }}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            <TextField
              name="name"
              label="客户名称"
              placeholder="例如：远景科技"
              required
              fullWidth
              value={name}
              onChange={(event) => {
                const nextName = event.target.value;
                setName(nextName);
                if (!slugTouched) {
                  setSlug(suggestSlug(nextName));
                }
              }}
              slotProps={{ htmlInput: { maxLength: 120 } }}
            />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                name="ownerName"
                label="负责人姓名"
                required
                fullWidth
                slotProps={{ htmlInput: { minLength: 2, maxLength: 60 } }}
              />
              <TextField
                name="ownerEmail"
                label="负责人邮箱"
                type="email"
                autoComplete="off"
                required
                fullWidth
              />
            </Stack>
            <TextField
              name="memberLimit"
              label="成员上限"
              type="number"
              defaultValue={2}
              required
              fullWidth
              slotProps={{ htmlInput: { min: 1, max: 1000 } }}
            />
            <Accordion variant="outlined" disableGutters>
              <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
                高级设置
              </AccordionSummary>
              <AccordionDetails>
                <TextField
                  name="slug"
                  label="客户标识"
                  placeholder="留空自动生成"
                  helperText={
                    slug || suggestedSlug
                      ? `当前标识：${(slug || suggestedSlug).toLowerCase()}`
                      : "仅支持小写字母、数字和连字符"
                  }
                  fullWidth
                  value={slug}
                  onChange={(event) => {
                    setSlugTouched(true);
                    setSlug(event.target.value.toLowerCase());
                  }}
                  slotProps={{
                    htmlInput: {
                      minLength: 0,
                      maxLength: 80,
                      pattern: "([a-z0-9]+(?:-[a-z0-9]+)*)?",
                    },
                  }}
                />
              </AccordionDetails>
            </Accordion>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button type="submit" variant="contained" disabled={submitting}>
            {submitting ? "正在创建" : "创建客户"}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
