"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Button,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";
import { useToast } from "@/components/shared/toast-provider";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";

export function ContentRiskPluginSettings({
  config,
  secrets,
  hasApiKey,
  busy,
  onConfigChange,
  onSecretChange,
  onSave,
}: {
  config: Record<string, unknown>;
  secrets?: Record<string, string>;
  hasApiKey?: boolean;
  busy?: boolean;
  onConfigChange: (next: Record<string, unknown>) => void;
  onSecretChange: (key: string, value: string) => void;
  onSave: () => Promise<void>;
}) {
  const toast = useToast();
  const [models, setModels] = useState<string[]>([]);
  const discoverModelsMutation = useMutation({
    mutationFn: ({ baseUrl, apiKey }: { baseUrl: string; apiKey?: string }) =>
      staffApi<{ models: string[] }>(
        "/api/v1/admin/plugins/content-contact-risk/models",
        jsonRequest("POST", {
          baseUrl,
          ...(apiKey ? { apiKey } : {}),
        }),
      ),
    onSuccess: (result) => {
      setModels(result.models);
      if (
        result.models.length === 1 &&
        !String(config.model ?? "").trim()
      ) {
        onConfigChange({ ...config, model: result.models[0] });
      }
      toast.success(`已获取 ${result.models.length} 个模型`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "获取模型失败");
    },
  });

  function discoverModels() {
    const baseUrl = String(config.baseUrl ?? "").trim();
    if (!baseUrl) {
      toast.warning("请先填写模型 Base URL");
      return;
    }
    if (!hasApiKey && !secrets?.apiKey?.trim()) {
      toast.warning("请先填写 API Key");
      return;
    }
    discoverModelsMutation.mutate({
      baseUrl,
      apiKey: secrets?.apiKey?.trim() || undefined,
    });
  }

  const selectedModel = String(config.model ?? "");
  const modelOptions = [...new Set([selectedModel, ...models].filter(Boolean))];

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 1 }}>
      <Stack spacing={2}>
        <TextField
          label="模型 Base URL"
          value={String(config.baseUrl ?? "")}
          onChange={(event) =>
            onConfigChange({ ...config, baseUrl: event.target.value })
          }
          helperText="系统使用该地址的 /v1/models 和 /v1/responses。"
          fullWidth
        />
        <TextField
          type="password"
          label="API Key"
          value={secrets?.apiKey ?? ""}
          onChange={(event) =>
            onSecretChange("apiKey", event.target.value)
          }
          helperText={
            hasApiKey
              ? "已加密保存；留空表示不修改"
              : "密钥仅在服务端使用"
          }
          autoComplete="new-password"
          fullWidth
        />
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
          <FormControl fullWidth>
            <InputLabel id="content-risk-model-label">检测模型</InputLabel>
            <Select
              labelId="content-risk-model-label"
              label="检测模型"
              value={selectedModel}
              onChange={(event) =>
                onConfigChange({ ...config, model: event.target.value })
              }
            >
              {modelOptions.map((model) => (
                <MenuItem key={model} value={model}>
                  {model}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button
            variant="outlined"
            startIcon={<RefreshOutlinedIcon />}
            onClick={() => void discoverModels()}
            disabled={busy || discoverModelsMutation.isPending}
            sx={{ flexShrink: 0 }}
          >
            获取模型
          </Button>
        </Stack>
        <FormControlLabel
          control={
            <Switch
              checked={config.fullAuditEnabled !== false}
              onChange={(event) =>
                onConfigChange({
                  ...config,
                  fullAuditEnabled: event.target.checked,
                })
              }
            />
          }
          label="开启后新内容全量发送后复查"
        />
        <Typography variant="body2" color="text.secondary">
          仅复查本次启用后的新内容和新编辑版本，不检查历史数据。
        </Typography>
        <Button
          variant="contained"
          onClick={() => void onSave()}
          disabled={busy}
        >
          保存配置
        </Button>
      </Stack>
    </Paper>
  );
}
