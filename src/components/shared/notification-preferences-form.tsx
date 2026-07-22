"use client";

import { useState } from "react";
import {
  Alert,
  Button,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  Typography,
} from "@mui/material";

type Preferences = {
  soundNotificationsEnabled: boolean;
  requestEmailNotificationsEnabled: boolean;
};

export function NotificationPreferencesForm({
  initialPreferences,
}: {
  initialPreferences: Preferences;
}) {
  const [preferences, setPreferences] = useState(initialPreferences);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/v1/me/notification-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preferences),
      });
      const result = (await response.json()) as {
        data?: Preferences;
        error?: { message?: string };
      };
      if (!response.ok || !result.data) {
        throw new Error(result.error?.message || "通知设置保存失败");
      }
      setPreferences(result.data);
      setSuccess("通知设置已保存");
      window.dispatchEvent(
        new CustomEvent("notification-preferences-updated", {
          detail: result.data,
        }),
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2.5, md: 3 } }}>
      <Stack spacing={2.25}>
        <div>
          <Typography sx={{ fontWeight: 700 }}>通知设置</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            设置会同步到使用此账号登录的其他设备。
          </Typography>
        </div>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {success ? <Alert severity="success">{success}</Alert> : null}
        <FormControlLabel
          control={
            <Switch
              checked={preferences.soundNotificationsEnabled}
              onChange={(event) =>
                setPreferences((current) => ({
                  ...current,
                  soundNotificationsEnabled: event.target.checked,
                }))
              }
            />
          }
          label="页面提示音"
        />
        <FormControlLabel
          control={
            <Switch
              checked={preferences.requestEmailNotificationsEnabled}
              onChange={(event) =>
                setPreferences((current) => ({
                  ...current,
                  requestEmailNotificationsEnabled: event.target.checked,
                }))
              }
            />
          }
          label="未读邮件提醒"
        />
        <Typography variant="body2" color="text.secondary" sx={{ mt: -1.5 }}>
          控制工单及管理员已开启的项目交付邮件；进入对应内容后自动取消待发邮件。
        </Typography>
        <Button
          variant="contained"
          onClick={() => void save()}
          disabled={saving}
          sx={{ alignSelf: { xs: "stretch", sm: "flex-start" } }}
        >
          {saving ? "保存中" : "保存通知设置"}
        </Button>
      </Stack>
    </Paper>
  );
}
