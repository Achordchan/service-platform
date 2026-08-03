"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Button,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import { useToast } from "@/components/shared/toast-provider";
import { apiRequest, jsonRequest } from "@/lib/api-client";

type Preferences = {
  soundNotificationsEnabled: boolean;
  requestEmailNotificationsEnabled: boolean;
};

export function NotificationPreferencesForm({
  initialPreferences,
}: {
  initialPreferences: Preferences;
}) {
  const toast = useToast();
  const [preferences, setPreferences] = useState(initialPreferences);
  const saveMutation = useMutation({
    mutationFn: (nextPreferences: Preferences) =>
      apiRequest<Preferences>(
        "/api/v1/me/notification-preferences",
        jsonRequest("PATCH", nextPreferences),
        "通知设置保存失败",
      ),
    onSuccess: (savedPreferences) => {
      setPreferences(savedPreferences);
      toast.success("通知设置已保存");
      window.dispatchEvent(
        new CustomEvent("notification-preferences-updated", {
          detail: savedPreferences,
        }),
      );
    },
    onError: (saveError) => {
      toast.error(saveError instanceof Error ? saveError.message : "保存失败");
    },
  });

  function save() {
    saveMutation.mutate(preferences);
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
          label="业务通知邮件"
        />
        <Typography variant="body2" color="text.secondary" sx={{ mt: -1.5 }}>
          控制服务请求及管理员已开启的项目交付通知邮件，包含尽快发送和未读后发送；进入对应内容后自动取消待发邮件。
        </Typography>
        <Button
          variant="contained"
          onClick={() => void save()}
          disabled={saveMutation.isPending}
          sx={{ alignSelf: { xs: "stretch", sm: "flex-start" } }}
        >
          {saveMutation.isPending ? "保存中" : "保存通知设置"}
        </Button>
      </Stack>
    </Paper>
  );
}
