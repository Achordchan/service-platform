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
import { useToast } from "@/components/shared/toast-provider";
import type { NotificationDeliveryRuleView } from "@/modules/notifications/notification-delivery-rules";

export type { NotificationDeliveryRuleView };

type Channel =
  | "notificationEnabled"
  | "soundEnabled"
  | "emailEnabled"
  | "dingtalkEnabled";

const channelDefinitions = [
  ["notificationEnabled", "通知红点"],
  ["soundEnabled", "页面提示音"],
  ["emailEnabled", "邮件提醒"],
  ["dingtalkEnabled", "钉钉机器人"],
] as const satisfies ReadonlyArray<readonly [Channel, string]>;

export function notificationRuleChannels(
  mailEnabled: boolean,
  dingTalkPluginEnabled: boolean,
) {
  return channelDefinitions.filter(([channel]) => {
    if (channel === "emailEnabled") return mailEnabled;
    if (channel === "dingtalkEnabled") return dingTalkPluginEnabled;
    return true;
  });
}

function channelSupported(
  rule: NotificationDeliveryRuleView,
  channel: Channel,
) {
  if (channel === "emailEnabled") return rule.emailSupported;
  if (channel === "dingtalkEnabled") return rule.dingtalkSupported;
  return true;
}

export function NotificationDeliveryRulesPanel({
  initialRules,
  standardEmailUnreadDelayEnabled,
  mailMode,
  dingTalkPluginEnabled,
  dingTalkPluginReady,
  onRulesChange,
  onUnreadDelayChange,
}: {
  initialRules: NotificationDeliveryRuleView[];
  standardEmailUnreadDelayEnabled: boolean;
  mailMode: "LOCAL_OUTBOX" | "RESEND" | "SMTP";
  dingTalkPluginEnabled: boolean;
  dingTalkPluginReady: boolean;
  onRulesChange?: (rules: NotificationDeliveryRuleView[]) => void;
  onUnreadDelayChange?: (enabled: boolean) => void;
}) {
  const toast = useToast();
  const [rules, setRules] = useState(initialRules);
  const [savedRules, setSavedRules] = useState(initialRules);
  const [saving, setSaving] = useState(false);
  const [savingEmailSwitch, setSavingEmailSwitch] = useState(false);
  const mailEnabled = mailMode !== "LOCAL_OUTBOX";
  const visibleChannels = notificationRuleChannels(
    mailEnabled,
    dingTalkPluginEnabled,
  );
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
      saved.emailEnabled !== rule.emailEnabled ||
      saved.dingtalkEnabled !== rule.dingtalkEnabled
    );
  });

  function applyRules(
    update: (current: NotificationDeliveryRuleView[]) => NotificationDeliveryRuleView[],
  ) {
    setRules(update);
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
        if (!channelSupported(rule, channel)) return rule;
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
    try {
      const next = await staffApi<NotificationDeliveryRuleView[]>(
        "/api/v1/admin/notification-delivery-rules",
        jsonRequest("PUT", {
          rules: rules.map(
            ({
              key,
              notificationEnabled,
              soundEnabled,
              emailEnabled,
              dingtalkEnabled,
            }) => ({
              key,
              notificationEnabled,
              soundEnabled,
              emailEnabled,
              dingtalkEnabled,
            }),
          ),
        }),
      );
      setRules(next);
      setSavedRules(next);
      onRulesChange?.(next);
      toast.success("通知规则已保存，仅对后续新事件生效");
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  const columnChecked = (channel: Channel) =>
    rules
      .filter((rule) => channelSupported(rule, channel))
      .every((rule) => rule[channel]);

  async function updateUnreadDelay(enabled: boolean) {
    setSavingEmailSwitch(true);
    try {
      await staffApi(
        "/api/v1/admin/settings",
        jsonRequest("PATCH", { standardEmailUnreadDelayEnabled: enabled }),
      );
      onUnreadDelayChange?.(enabled);
      toast.success(enabled ? "未读 5 分钟延迟已开启" : "邮件已改为尽快发送");
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : "保存失败");
    } finally {
      setSavingEmailSwitch(false);
    }
  }

  return (
    <Stack spacing={2.5}>
      {mailEnabled ? (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "minmax(0, 1fr) auto" },
            gap: 1.5,
            alignItems: "center",
            border: "1px solid",
            borderColor: "divider",
            px: 2,
            py: 1.75,
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 700 }}>未读 5 分钟后发送</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>
              开启后，邮件提醒会等待 5 分钟；期间用户已阅读则自动取消。关闭后，新邮件提醒会尽快发送。
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Typography variant="body2" color="text.secondary">
              {standardEmailUnreadDelayEnabled ? "延迟发送" : "尽快发送"}
            </Typography>
            <Switch
              checked={standardEmailUnreadDelayEnabled}
              disabled={savingEmailSwitch}
              onChange={(event) =>
                void updateUnreadDelay(event.target.checked)
              }
              slotProps={{ input: { "aria-label": "未读五分钟后发送" } }}
            />
          </Stack>
        </Box>
      ) : null}
      {mailEnabled ? (
        <Alert severity="info">
          下方“邮件提醒”决定各场景是否发信；此开关只控制发送时机。收件人个人偏好仍可单独关闭邮件。
        </Alert>
      ) : null}
      {dingTalkPluginEnabled && !dingTalkPluginReady ? (
        <Alert severity="warning">
          钉钉机器人插件当前未通过运行环境检测，规则会保留，但新事件暂时不会发送。
        </Alert>
      ) : dingTalkPluginEnabled ? (
        <Alert severity="info">
          当前插件支持“新建服务请求”和“客户公开回复”。规则保存后对新事件立即生效，不补发历史内容，也不受邮件未读延迟控制。
        </Alert>
      ) : null}
      <Box
        sx={{
          overflowX: "auto",
          border: "1px solid",
          borderColor: "divider",
        }}
      >
        <Table
          size="small"
          sx={{ minWidth: Math.max(560, 280 + visibleChannels.length * 150) }}
        >
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 130 }}>业务分类</TableCell>
              <TableCell>通知场景</TableCell>
              {visibleChannels.map(([channel, label]) => (
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
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 650 }}>
                      {rule.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {rule.description}
                    </Typography>
                  </TableCell>
                  {visibleChannels.map(([channel, label]) => (
                    <TableCell key={channel} align="center">
                      {channelSupported(rule, channel) ? (
                        <Switch
                          size="small"
                          checked={rule[channel]}
                          disabled={
                            (channel === "emailEnabled" &&
                              !rule.notificationEnabled) ||
                            (rule.key === "CONTENT_RISK_ALERT" &&
                              channel === "notificationEnabled")
                          }
                          onChange={(event) =>
                            updateRule(
                              rule.key,
                              channel,
                              event.target.checked,
                            )
                          }
                          slotProps={{
                            input: { "aria-label": `${rule.label}${label}` },
                          }}
                        />
                      ) : (
                        <Typography
                          variant="body2"
                          color="text.disabled"
                          aria-label={`${rule.label}${label}不支持`}
                        >
                          —
                        </Typography>
                      )}
                    </TableCell>
                  ))}
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
