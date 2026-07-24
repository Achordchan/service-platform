"use client";

import { useState } from "react";
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
import { useToast } from "@/components/shared/toast-provider";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";
import type { MailTemplateView } from "@/components/staff/platform-settings-types";

function MailTemplateEditor({
  template,
  currentAdminEmail,
  busy,
  onBusy,
  onTemplatesChange,
  onMessage,
}: {
  template: MailTemplateView;
  currentAdminEmail: string;
  busy: string | null;
  onBusy: (value: string | null) => void;
  onTemplatesChange: (templates: MailTemplateView[]) => void;
  onMessage: (message: { type: "success" | "error"; text: string }) => void;
}) {
  const [testEmail, setTestEmail] = useState(currentAdminEmail);
  const [subject, setSubject] = useState(template.content.subject);
  const [previewText, setPreviewText] = useState(
    template.content.previewText,
  );
  const [heading, setHeading] = useState(template.content.heading);
  const [body, setBody] = useState(template.content.body);
  const [actionLabel, setActionLabel] = useState(
    template.content.actionLabel ?? "",
  );
  const actionKey = `${template.key}:action`;
  const sampleByKey = Object.fromEntries(
    template.variables.map((variable) => [variable.key, variable.sample]),
  );
  const renderSample = (value: string) =>
    value.replace(
      /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g,
      (match, variable: string) => sampleByKey[variable] ?? match,
    );

  async function saveTemplate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onBusy(actionKey);
    const form = new FormData(event.currentTarget);
    try {
      const templates = await staffApi<MailTemplateView[]>(
        `/api/v1/admin/mail/templates/${encodeURIComponent(template.key)}`,
        jsonRequest("PATCH", {
          subject: String(form.get("subject") ?? "").trim(),
          previewText: String(form.get("previewText") ?? "").trim(),
          heading: String(form.get("heading") ?? "").trim(),
          body: String(form.get("body") ?? "").trim(),
          actionLabel:
            String(form.get("actionLabel") ?? "").trim() || null,
        }),
      );
      onTemplatesChange(templates);
      onMessage({ type: "success", text: `${template.name}已保存` });
    } catch (error) {
      onMessage({
        type: "error",
        text: error instanceof Error ? error.message : "模板保存失败",
      });
    } finally {
      onBusy(null);
    }
  }

  async function resetTemplate() {
    if (!window.confirm(`确认将“${template.name}”恢复为系统默认内容？`)) {
      return;
    }
    onBusy(actionKey);
    try {
      const templates = await staffApi<MailTemplateView[]>(
        `/api/v1/admin/mail/templates/${encodeURIComponent(template.key)}`,
        jsonRequest("DELETE"),
      );
      onTemplatesChange(templates);
      onMessage({ type: "success", text: `${template.name}已恢复默认` });
    } catch (error) {
      onMessage({
        type: "error",
        text: error instanceof Error ? error.message : "恢复默认失败",
      });
    } finally {
      onBusy(null);
    }
  }

  async function sendTest() {
    onBusy(actionKey);
    try {
      await staffApi(
        "/api/v1/admin/mail/test",
        jsonRequest("POST", {
          to: testEmail.trim(),
          templateKey: template.key,
        }),
      );
      onMessage({
        type: "success",
        text: `${template.name}测试邮件已加入队列`,
      });
    } catch (error) {
      onMessage({
        type: "error",
        text: error instanceof Error ? error.message : "测试邮件发送失败",
      });
    } finally {
      onBusy(null);
    }
  }

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
      <TextField
        name="subject"
        label="邮件主题"
        value={subject}
        onChange={(event) => setSubject(event.target.value)}
        required
        fullWidth
      />
      <TextField
        name="previewText"
        label="收件箱预览文字"
        value={previewText}
        onChange={(event) => setPreviewText(event.target.value)}
        required
        fullWidth
      />
      <TextField
        name="heading"
        label="正文标题"
        value={heading}
        onChange={(event) => setHeading(event.target.value)}
        required
        fullWidth
      />
      <TextField
        name="body"
        label="正文"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        required
        multiline
        minRows={4}
        fullWidth
      />
      <TextField
        name="actionLabel"
        label="按钮文字"
        value={actionLabel}
        onChange={(event) => setActionLabel(event.target.value)}
        fullWidth
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
        <TextField
          label="测试收件邮箱"
          type="email"
          value={testEmail}
          onChange={(event) => setTestEmail(event.target.value)}
          fullWidth
        />
        <Button
          type="button"
          variant="outlined"
          onClick={sendTest}
          disabled={busy !== null || !testEmail.trim()}
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
  const [busy, setBusy] = useState<string | null>(null);
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
              busy={busy}
              onBusy={setBusy}
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
