"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useAppConfirm } from "@/components/shared/confirm-provider";
import { useToast } from "@/components/shared/toast-provider";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";
import type { MailTemplateView } from "@/components/staff/platform-settings-types";

const mailTemplateFormSchema = z.object({
  subject: z.string().trim().min(1, "请填写邮件主题").max(200),
  previewText: z.string().trim().min(1, "请填写预览文字").max(240),
  heading: z.string().trim().min(1, "请填写正文标题").max(160),
  body: z.string().trim().min(1, "请填写正文").max(3000),
  actionLabel: z.string().trim().max(80),
});
const testEmailFormSchema = z.object({
  email: z.email("请输入有效邮箱"),
});

type MailTemplateFormValues = z.infer<typeof mailTemplateFormSchema>;
type TestEmailFormValues = z.infer<typeof testEmailFormSchema>;

function MailTemplateEditor({
  template,
  currentAdminEmail,
  onTemplatesChange,
  onMessage,
}: {
  template: MailTemplateView;
  currentAdminEmail: string;
  onTemplatesChange: (templates: MailTemplateView[]) => void;
  onMessage: (message: { type: "success" | "error"; text: string }) => void;
}) {
  const confirm = useAppConfirm();
  const templateForm = useForm<MailTemplateFormValues>({
    resolver: zodResolver(mailTemplateFormSchema),
    defaultValues: {
      subject: template.content.subject,
      previewText: template.content.previewText,
      heading: template.content.heading,
      body: template.content.body,
      actionLabel: template.content.actionLabel ?? "",
    },
  });
  const testForm = useForm<TestEmailFormValues>({
    resolver: zodResolver(testEmailFormSchema),
    defaultValues: { email: currentAdminEmail },
  });
  const subject = useWatch({ control: templateForm.control, name: "subject" });
  const previewText = useWatch({ control: templateForm.control, name: "previewText" });
  const heading = useWatch({ control: templateForm.control, name: "heading" });
  const body = useWatch({ control: templateForm.control, name: "body" });
  const actionLabel = useWatch({ control: templateForm.control, name: "actionLabel" });
  const actionKey = `${template.key}:action`;
  const actionMutation = useMutation({
    mutationFn: ({ run }: { key: string; run: () => Promise<unknown> }) =>
      run(),
  });
  const busy = actionMutation.isPending
    ? (actionMutation.variables?.key ?? actionKey)
    : null;
  const sampleByKey = Object.fromEntries(
    template.variables.map((variable) => [variable.key, variable.sample]),
  );
  const renderSample = (value: string) =>
    value.replace(
      /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g,
      (match, variable: string) => sampleByKey[variable] ?? match,
    );

  async function execute<T>(
    run: () => Promise<T>,
    fallbackError: string,
  ): Promise<{ ok: true; value: T } | { ok: false }> {
    try {
      const value = (await actionMutation.mutateAsync({
        key: actionKey,
        run,
      })) as T;
      return { ok: true, value };
    } catch (error) {
      onMessage({
        type: "error",
        text: error instanceof Error ? error.message : fallbackError,
      });
      return { ok: false };
    }
  }

  const saveTemplate = templateForm.handleSubmit(async (values) => {
    const result = await execute(
      () =>
        staffApi<MailTemplateView[]>(
          `/api/v1/admin/mail/templates/${encodeURIComponent(template.key)}`,
          jsonRequest("PATCH", {
            ...values,
            actionLabel: values.actionLabel || null,
          }),
        ),
      "模板保存失败",
    );
    if (!result.ok) return;
    onTemplatesChange(result.value);
    onMessage({ type: "success", text: `${template.name}已保存` });
  });

  async function resetTemplate() {
    const confirmed = await confirm({
      title: "恢复系统默认模板？",
      description: `“${template.name}”的自定义内容将被系统默认内容覆盖。`,
      confirmationText: "恢复默认",
      confirmationButtonProps: { color: "error", variant: "contained" },
    });
    if (!confirmed) return;
    const result = await execute(
      () =>
        staffApi<MailTemplateView[]>(
          `/api/v1/admin/mail/templates/${encodeURIComponent(template.key)}`,
          jsonRequest("DELETE"),
        ),
      "恢复默认失败",
    );
    if (!result.ok) return;
    onTemplatesChange(result.value);
    onMessage({ type: "success", text: `${template.name}已恢复默认` });
  }

  const sendTest = testForm.handleSubmit(async ({ email }) => {
    const result = await execute(
      () =>
        staffApi(
          "/api/v1/admin/mail/test",
          jsonRequest("POST", {
            to: email.trim(),
            templateKey: template.key,
          }),
        ),
      "测试邮件发送失败",
    );
    if (!result.ok) return;
    onMessage({
      type: "success",
      text: `${template.name}测试邮件已加入队列`,
    });
  });

  return (
    <Stack
      key={`${template.key}-${template.updatedAt ?? "default"}`}
      component="form"
      spacing={2}
      onSubmit={saveTemplate}
    >
      {template.variables.length > 0 ? (
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ flexWrap: "wrap" }}
        >
          <Typography variant="body2" color="text.secondary">
            可用变量：
          </Typography>
          {template.variables.map((variable) => (
            <Chip
              key={variable.key}
              size="small"
              variant="outlined"
              label={`{{${variable.key}}} · ${variable.label}`}
              sx={{ fontFamily: "monospace" }}
            />
          ))}
        </Stack>
      ) : null}
      <Controller
        name="subject"
        control={templateForm.control}
        render={({ field }) => (
          <TextField {...field} label="邮件主题" required fullWidth error={Boolean(templateForm.formState.errors.subject)} helperText={templateForm.formState.errors.subject?.message} />
        )}
      />
      <Controller
        name="previewText"
        control={templateForm.control}
        render={({ field }) => (
          <TextField {...field} label="收件箱预览文字" required fullWidth error={Boolean(templateForm.formState.errors.previewText)} helperText={templateForm.formState.errors.previewText?.message} />
        )}
      />
      <Controller
        name="heading"
        control={templateForm.control}
        render={({ field }) => (
          <TextField {...field} label="正文标题" required fullWidth error={Boolean(templateForm.formState.errors.heading)} helperText={templateForm.formState.errors.heading?.message} />
        )}
      />
      <Controller
        name="body"
        control={templateForm.control}
        render={({ field }) => (
          <TextField {...field} label="正文" required multiline minRows={4} fullWidth error={Boolean(templateForm.formState.errors.body)} helperText={templateForm.formState.errors.body?.message} />
        )}
      />
      <Controller
        name="actionLabel"
        control={templateForm.control}
        render={({ field }) => (
          <TextField {...field} label="按钮文字" fullWidth error={Boolean(templateForm.formState.errors.actionLabel)} helperText={templateForm.formState.errors.actionLabel?.message} />
        )}
      />

      <Box
        sx={{
          p: { xs: 2, sm: 3 },
          bgcolor: "#f3f5f7",
          overflow: "hidden",
        }}
      >
        <Typography variant="overline" color="text.secondary">
          预览
        </Typography>
        <Typography sx={{ mt: 0.5, fontWeight: 700 }}>
          {renderSample(subject)}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {renderSample(previewText)}
        </Typography>
        <Paper
          variant="outlined"
          sx={{
            mt: 2,
            p: { xs: 2.5, sm: 4 },
            bgcolor: "common.white",
            borderColor: "#e2e7ee",
          }}
        >
          <Typography
            sx={{
              pb: 2,
              mb: 2.5,
              borderBottom: "1px solid",
              borderColor: "divider",
              color: "primary.main",
              fontSize: 15,
              fontWeight: 700,
            }}
          >
            服务支持中心
          </Typography>
          <Typography
            variant="h3"
            sx={{ fontSize: { xs: 23, sm: 26 }, fontWeight: 700, lineHeight: 1.4 }}
          >
            {renderSample(heading)}
          </Typography>
          <Typography
            sx={{
              mt: 1.75,
              color: "#374151",
              fontSize: 16,
              lineHeight: 1.8,
              whiteSpace: "pre-line",
              overflowWrap: "anywhere",
            }}
          >
            {renderSample(body)}
          </Typography>
          {actionLabel ? (
            <Button
              variant="contained"
              sx={{ mt: 3, minHeight: 42, px: 2.5, borderRadius: 1 }}
            >
              {renderSample(actionLabel)}
            </Button>
          ) : null}
          <Typography
            sx={{
              mt: 4,
              pt: 2.5,
              borderTop: "1px solid",
              borderColor: "divider",
              color: "text.secondary",
              fontSize: 13,
              lineHeight: 1.7,
            }}
          >
            此邮件由系统自动发送。如需帮助，请直接回复此邮件。
          </Typography>
        </Paper>
      </Box>

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        sx={{ justifyContent: "space-between" }}
      >
        <Button
          type="button"
          color="error"
          onClick={resetTemplate}
          disabled={busy !== null || !template.customized}
        >
          恢复默认
        </Button>
        <Button type="submit" variant="contained" disabled={busy !== null}>
          {busy === actionKey ? "处理中" : "保存模板"}
        </Button>
      </Stack>

      <Divider />
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
        <Controller
          name="email"
          control={testForm.control}
          render={({ field }) => (
            <TextField {...field} label="测试收件邮箱" type="email" fullWidth error={Boolean(testForm.formState.errors.email)} helperText={testForm.formState.errors.email?.message} />
          )}
        />
        <Button
          type="button"
          variant="outlined"
          onClick={() => void sendTest()}
          disabled={busy !== null}
          sx={{ whiteSpace: "nowrap" }}
        >
          发送测试
        </Button>
      </Stack>
    </Stack>
  );
}

export function MailTemplateManager({
  initialTemplates,
  currentAdminEmail,
  embedded = false,
}: {
  initialTemplates: MailTemplateView[];
  currentAdminEmail: string;
  embedded?: boolean;
}) {
  const toast = useToast();
  const [templates, setTemplates] = useState(initialTemplates);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selectedTemplate =
    templates.find((template) => template.key === selectedKey) ?? null;
  const templateList = (
    <>
      {!embedded ? (
        <Box sx={{ px: { xs: 2, sm: 2.5 }, py: 2.25 }}>
          <Typography sx={{ fontWeight: 700 }}>邮件模板</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {templates.length} 个模板
          </Typography>
        </Box>
      ) : null}
      {!embedded ? <Divider /> : null}
      {templates.map((template, index) => (
        <Box key={template.key}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            sx={{
              px: { xs: 2, sm: 2.5 },
              py: 2,
              alignItems: { sm: "center" },
              justifyContent: "space-between",
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Stack
                direction="row"
                spacing={1}
                useFlexGap
                sx={{ alignItems: "center", flexWrap: "wrap" }}
              >
                <Typography sx={{ fontWeight: 650 }}>
                  {template.name}
                </Typography>
                <Chip
                  size="small"
                  label={template.customized ? "已自定义" : "系统默认"}
                  color={template.customized ? "primary" : "default"}
                />
              </Stack>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.5 }}
              >
                {template.description}
              </Typography>
            </Box>
            <Button
              variant="outlined"
              onClick={() => setSelectedKey(template.key)}
              sx={{ alignSelf: { xs: "stretch", sm: "center" } }}
            >
              编辑
            </Button>
          </Stack>
          {index < templates.length - 1 ? <Divider /> : null}
        </Box>
      ))}
    </>
  );

  return (
    <>
      {embedded ? (
        <Box>{templateList}</Box>
      ) : (
        <Paper variant="outlined" sx={{ overflow: "hidden" }}>
          {templateList}
        </Paper>
      )}

      <Dialog
        open={selectedTemplate !== null}
        onClose={() => setSelectedKey(null)}
        fullWidth
        maxWidth="md"
        scroll="paper"
      >
        <DialogTitle>
          {selectedTemplate?.name ?? "邮件模板"}
        </DialogTitle>
        <DialogContent dividers>
          {selectedTemplate ? (
            <MailTemplateEditor
              key={`${selectedTemplate.key}-${selectedTemplate.updatedAt ?? "default"}`}
              template={selectedTemplate}
              currentAdminEmail={currentAdminEmail}
              onTemplatesChange={setTemplates}
              onMessage={(message) =>
                toast.show(message.text, { severity: message.type })
              }
            />
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedKey(null)}>关闭</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
