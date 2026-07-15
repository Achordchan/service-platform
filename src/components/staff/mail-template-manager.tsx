"use client";

import { useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ExpandMoreOutlinedIcon from "@mui/icons-material/ExpandMoreOutlined";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";
import type {
  MailTemplateView,
} from "@/components/staff/platform-settings-types";

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
    <Accordion
      disableGutters
      elevation={0}
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: "8px !important",
        overflow: "hidden",
        "&:before": { display: "none" },
      }}
    >
      <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{
            width: "100%",
            pr: 1,
            alignItems: { sm: "center" },
            justifyContent: "space-between",
          }}
        >
          <Box>
            <Typography sx={{ fontWeight: 700 }}>{template.name}</Typography>
            <Typography variant="body2" color="text.secondary">
              {template.description}
            </Typography>
          </Box>
          <Chip
            size="small"
            label={template.customized ? "已自定义" : "系统默认"}
            color={template.customized ? "primary" : "default"}
          />
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 0 }}>
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
            helperText="多数邮箱会在主题后显示这段摘要"
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
            helperText="留空则不显示操作按钮"
          />

          <Paper
            variant="outlined"
            sx={{
              p: { xs: 2, sm: 2.5 },
              bgcolor: "grey.50",
              overflow: "hidden",
            }}
          >
            <Typography variant="overline" color="text.secondary">
              示例预览
            </Typography>
            <Typography sx={{ mt: 0.5, fontWeight: 700 }}>
              {renderSample(subject)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {renderSample(previewText)}
            </Typography>
            <Divider sx={{ my: 2 }} />
            <Typography variant="h3" sx={{ fontSize: 20, fontWeight: 700 }}>
              {renderSample(heading)}
            </Typography>
            <Typography
              color="text.secondary"
              sx={{ mt: 1, whiteSpace: "pre-line" }}
            >
              {renderSample(body)}
            </Typography>
            {actionLabel ? (
              <Button variant="contained" size="small" sx={{ mt: 2 }}>
                {renderSample(actionLabel)}
              </Button>
            ) : null}
          </Paper>

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
              发送此模板测试
            </Button>
          </Stack>
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}

export function MailTemplateManager({
  initialTemplates,
  currentAdminEmail,
}: {
  initialTemplates: MailTemplateView[];
  currentAdminEmail: string;
}) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2.5, md: 3 } }}>
      <Stack spacing={2}>
        {message ? (
          <Alert severity={message.type}>{message.text}</Alert>
        ) : null}
        {templates.map((template) => (
          <MailTemplateEditor
            key={`${template.key}-${template.updatedAt ?? "default"}`}
            template={template}
            currentAdminEmail={currentAdminEmail}
            busy={busy}
            onBusy={setBusy}
            onTemplatesChange={setTemplates}
            onMessage={setMessage}
          />
        ))}
      </Stack>
    </Paper>
  );
}
