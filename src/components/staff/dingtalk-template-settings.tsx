"use client";

import { useMemo, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
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
import ExpandMoreOutlinedIcon from "@mui/icons-material/ExpandMoreOutlined";
import SendOutlinedIcon from "@mui/icons-material/SendOutlined";
import {
  DINGTALK_ROBOT_DEFAULT_CONFIG,
  DINGTALK_ROBOT_KEYWORD,
  DINGTALK_ROBOT_TEMPLATE_DEFINITIONS,
  DINGTALK_ROBOT_TEMPLATE_VARIABLES,
  parseDingTalkRobotConfig,
  type DingTalkRobotConfig,
  type DingTalkRobotEventType,
  type DingTalkRobotTemplate,
} from "@achord/plugin-dingtalk-robot/config";

type Props = {
  config: Record<string, unknown>;
  busy: boolean;
  canTest: boolean;
  onSave: (config: DingTalkRobotConfig) => Promise<boolean>;
  onTest: (
    eventType: DingTalkRobotEventType,
    template: DingTalkRobotTemplate,
  ) => Promise<void>;
};

export function DingTalkTemplateSettings({
  config,
  busy,
  canTest,
  onSave,
  onTest,
}: Props) {
  const parsedConfig = useMemo(() => {
    try {
      return parseDingTalkRobotConfig(config);
    } catch {
      return structuredClone(DINGTALK_ROBOT_DEFAULT_CONFIG);
    }
  }, [config]);
  const [selectedKey, setSelectedKey] =
    useState<DingTalkRobotEventType | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const selectedDefinition = DINGTALK_ROBOT_TEMPLATE_DEFINITIONS.find(
    (definition) => definition.key === selectedKey,
  );
  const draft = { title: title.trim(), body: body.trim() };
  const sampleByKey = Object.fromEntries(
    DINGTALK_ROBOT_TEMPLATE_VARIABLES.map((variable) => [
      variable.key,
      variable.sample,
    ]),
  );
  const renderSample = (value: string) =>
    value.replace(
      /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g,
      (match, variable: string) => sampleByKey[variable] ?? match,
    );

  function openEditor(eventType: DingTalkRobotEventType) {
    const template = parsedConfig.templates[eventType];
    setSelectedKey(eventType);
    setTitle(template.title);
    setBody(template.body);
  }

  function restoreDefault() {
    if (!selectedKey) return;
    const template = DINGTALK_ROBOT_DEFAULT_CONFIG.templates[selectedKey];
    setTitle(template.title);
    setBody(template.body);
  }

  async function save() {
    if (!selectedKey || !draft.title || !draft.body) return;
    const saved = await onSave({
      ...parsedConfig,
      templates: {
        ...parsedConfig.templates,
        [selectedKey]: draft,
      },
    });
    if (saved) setSelectedKey(null);
  }

  return (
    <>
      <Accordion variant="outlined" disableGutters>
        <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
          <Typography sx={{ fontWeight: 650 }}>钉钉通知模板</Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ p: 0 }}>
          {DINGTALK_ROBOT_TEMPLATE_DEFINITIONS.map((definition, index) => {
            const template = parsedConfig.templates[definition.key];
            const customized =
              JSON.stringify(template) !==
              JSON.stringify(
                DINGTALK_ROBOT_DEFAULT_CONFIG.templates[definition.key],
              );
            return (
              <Box key={definition.key}>
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1.5}
                  sx={{
                    px: 2,
                    py: 1.75,
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
                        {definition.name}
                      </Typography>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={customized ? "已自定义" : "系统默认"}
                        color={customized ? "primary" : "default"}
                      />
                    </Stack>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mt: 0.4 }}
                    >
                      {definition.description}
                    </Typography>
                  </Box>
                  <Button
                    variant="outlined"
                    onClick={() => openEditor(definition.key)}
                    sx={{ alignSelf: { xs: "stretch", sm: "center" } }}
                  >
                    编辑
                  </Button>
                </Stack>
                {index < DINGTALK_ROBOT_TEMPLATE_DEFINITIONS.length - 1 ? (
                  <Divider />
                ) : null}
              </Box>
            );
          })}
        </AccordionDetails>
      </Accordion>

      <Dialog
        open={selectedKey !== null}
        onClose={busy ? undefined : () => setSelectedKey(null)}
        fullWidth
        maxWidth="md"
        scroll="paper"
      >
        <DialogTitle>{selectedDefinition?.name ?? "钉钉通知模板"}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
              {DINGTALK_ROBOT_TEMPLATE_VARIABLES.map((variable) => (
                <Chip
                  key={variable.key}
                  size="small"
                  variant="outlined"
                  label={`{{${variable.key}}} · ${variable.label}`}
                  sx={{ fontFamily: "monospace" }}
                />
              ))}
            </Stack>
            <TextField
              label="消息标题"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              fullWidth
              slotProps={{ htmlInput: { maxLength: 80 } }}
            />
            <TextField
              label="Markdown 正文"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              required
              multiline
              minRows={7}
              fullWidth
              slotProps={{ htmlInput: { maxLength: 2000 } }}
            />
            <Paper
              variant="outlined"
              sx={{ p: { xs: 2, sm: 2.5 }, bgcolor: "#f7f8fa" }}
            >
              <Typography variant="overline" color="text.secondary">
                消息预览
              </Typography>
              <Typography sx={{ mt: 0.5, fontWeight: 700, fontSize: 18 }}>
                {DINGTALK_ROBOT_KEYWORD}：{renderSample(title)}
              </Typography>
              <Typography
                component="div"
                sx={{
                  mt: 1.5,
                  color: "text.secondary",
                  lineHeight: 1.8,
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                }}
              >
                {renderSample(body)}
              </Typography>
              <Typography sx={{ mt: 2, color: "primary.main", fontWeight: 650 }}>
                打开工单
              </Typography>
            </Paper>
          </Stack>
        </DialogContent>
        <DialogActions
          sx={{
            px: 3,
            py: 2,
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 1,
          }}
        >
          <Button color="error" onClick={restoreDefault} disabled={busy}>
            恢复默认
          </Button>
          <Stack direction="row" spacing={1}>
            <Button
              startIcon={<SendOutlinedIcon />}
              onClick={() =>
                selectedKey ? void onTest(selectedKey, draft) : undefined
              }
              disabled={busy || !canTest || !draft.title || !draft.body}
            >
              发送测试
            </Button>
            <Button
              variant="contained"
              onClick={() => void save()}
              disabled={busy || !draft.title || !draft.body}
            >
              保存模板
            </Button>
          </Stack>
        </DialogActions>
      </Dialog>
    </>
  );
}
