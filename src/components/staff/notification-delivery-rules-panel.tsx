"use client";

import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";
import type { NotificationDeliveryRuleView } from "@/modules/notifications/notification-delivery-rules";

export type { NotificationDeliveryRuleView };

type Channel = "notificationEnabled" | "soundEnabled" | "emailEnabled";

export function NotificationDeliveryRulesPanel({
  initialRules,
  standardRequestEmailEnabled,
  onRulesChange,
}: {
  initialRules: NotificationDeliveryRuleView[];
  standardRequestEmailEnabled: boolean;
  onRulesChange?: (rules: NotificationDeliveryRuleView[]) => void;
}) {
  const [rules, setRules] = useState(initialRules);
  const [savedRules, setSavedRules] = useState(initialRules);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const categories = useMemo(
    () => [...new Set(rules.map((rule) => rule.category))],
    [rules],
  );
  const savedByKey = useMemo(
    () => new Map(savedRules.map((rule) => [rule.key, rule])),
    [savedRules],
  );
  const dirty = rules.some((rule) => {
    const saved = savedByKey.get(rule.key);
    return (
      !saved ||
      saved.notificationEnabled !== rule.notificationEnabled ||
      saved.soundEnabled !== rule.soundEnabled ||
      saved.emailEnabled !== rule.emailEnabled
    );
  });

  function applyRules(
    update: (current: NotificationDeliveryRuleView[]) => NotificationDeliveryRuleView[],
  ) {
    setRules(update);
    setError("");
    setSuccess("");
  }

  function updateRule(key: string, channel: Channel, checked: boolean) {
    applyRules((current) =>
      current.map((rule) => {
        if (rule.key !== key) return rule;
        if (channel === "notificationEnabled" && !checked) {
          return { ...rule, notificationEnabled: false, emailEnabled: false };
        }
        return { ...rule, [channel]: checked };
      }),
    );
  }

  function updateColumn(channel: Channel, checked: boolean) {
    applyRules((current) =>
      current.map((rule) => {
        if (channel === "emailEnabled" && !rule.emailSupported) return rule;
        if (channel === "notificationEnabled" && !checked) {
          return { ...rule, notificationEnabled: false, emailEnabled: false };
        }
        if (channel === "emailEnabled" && checked) {
          return { ...rule, notificationEnabled: true, emailEnabled: true };
        }
        return { ...rule, [channel]: checked };
      }),
    );
  }

  async function save() {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const next = await staffApi<NotificationDeliveryRuleView[]>(
        "/api/v1/admin/notification-delivery-rules",
        jsonRequest("PUT", {
          rules: rules.map(({ key, notificationEnabled, soundEnabled, emailEnabled }) => ({
            key,
            notificationEnabled,
            soundEnabled,
            emailEnabled,
          })),
        }),
      );
      setRules(next);
      setSavedRules(next);
      onRulesChange?.(next);
      setSuccess("通知规则已保存");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  const columnChecked = (channel: Channel) =>
    rules
      .filter((rule) => channel !== "emailEnabled" || rule.emailSupported)
      .every((rule) => rule[channel]);

  return (
    <Stack spacing={2.5}>
      <Alert severity={standardRequestEmailEnabled ? "info" : "warning"}>
        实时数据刷新始终开启。此处邮件控制标准项目的五分钟未读提醒，只对保存规则后产生的新事件生效，不补发历史通知。平台总开关当前
        {standardRequestEmailEnabled ? "已开启" : "未开启"}，并受收件人个人偏好控制；外部接入即时邮件仍由对应项目连接器管理。
      </Alert>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {success ? <Alert severity="success">{success}</Alert> : null}
      <Box
        sx={{
          overflowX: "auto",
          border: "1px solid",
          borderColor: "divider",
        }}
      >
        <Table size="small" sx={{ minWidth: 720 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 130 }}>业务分类</TableCell>
              <TableCell>通知场景</TableCell>
              {([
                ["notificationEnabled", "通知红点"],
                ["soundEnabled", "页面提示音"],
                ["emailEnabled", "邮件提醒"],
              ] as const).map(([channel, label]) => (
                <TableCell key={channel} align="center" sx={{ width: 150 }}>
                  <Stack
                    direction="row"
                    spacing={0.5}
                    sx={{ alignItems: "center", justifyContent: "center" }}
                  >
                    <Switch
                      size="small"
                      checked={columnChecked(channel)}
                      onChange={(event) => updateColumn(channel, event.target.checked)}
                      slotProps={{
                        input: { "aria-label": `${label}全部开关` },
                      }}
                    />
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {label}
                    </Typography>
                  </Stack>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {categories.flatMap((category) => {
              const group = rules.filter((rule) => rule.category === category);
              return group.map((rule, index) => (
                <TableRow key={rule.key} hover>
                  {index === 0 ? (
                    <TableCell
                      rowSpan={group.length}
                      sx={{
                        bgcolor: "action.hover",
                        fontWeight: 700,
                        verticalAlign: "top",
                        pt: 2,
                      }}
                    >
                      {category}
                    </TableCell>
                  ) : null}
                  <TableCell>{rule.label}</TableCell>
                  <TableCell align="center">
                    <Switch
                      size="small"
                      checked={rule.notificationEnabled}
                      onChange={(event) =>
                        updateRule(
                          rule.key,
                          "notificationEnabled",
                          event.target.checked,
                        )
                      }
                      slotProps={{
                        input: { "aria-label": `${rule.label}通知红点` },
                      }}
                    />
                  </TableCell>
                  <TableCell align="center">
                    <Switch
                      size="small"
                      checked={rule.soundEnabled}
                      onChange={(event) =>
                        updateRule(
                          rule.key,
                          "soundEnabled",
                          event.target.checked,
                        )
                      }
                      slotProps={{
                        input: { "aria-label": `${rule.label}页面提示音` },
                      }}
                    />
                  </TableCell>
                  <TableCell align="center">
                    {rule.emailSupported ? (
                      <Switch
                        size="small"
                        checked={rule.emailEnabled}
                        disabled={!rule.notificationEnabled}
                        onChange={(event) =>
                          updateRule(
                            rule.key,
                            "emailEnabled",
                            event.target.checked,
                          )
                        }
                        slotProps={{
                          input: { "aria-label": `${rule.label}邮件提醒` },
                        }}
                      />
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        不可用
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              ));
            })}
          </TableBody>
        </Table>
      </Box>
      <Button
        variant="contained"
        disabled={saving || !dirty}
        onClick={() => void save()}
        sx={{ alignSelf: { xs: "stretch", sm: "flex-end" } }}
      >
        {saving ? "保存中" : "保存通知规则"}
      </Button>
    </Stack>
  );
}
