"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Link as MuiLink,
  Stack,
  Typography,
} from "@mui/material";
import NotificationsActiveOutlinedIcon from "@mui/icons-material/NotificationsActiveOutlined";
import { staffApi, jsonRequest } from "@/components/staff/staff-api";
import { useDeliveryChannelRule } from "@/hooks/use-delivery-channels";
import {
  DELIVERY_CHANNEL_LABELS,
  RULE_KEY_BY_SCENE,
  deliveryNoticeChannels,
  deliveryNoticeText,
  isDeliveryOverrideActive,
  materializeDeliveryOverride,
  type DeliveryScene,
} from "@/lib/delivery-notice";
import type { NotificationDeliveryOverride } from "@/modules/notifications/notification-delivery-override";

type EmailState = "READY" | "USER_OFF" | "NOT_TARGETED";
type WechatState = "READY" | "NO_BINDING" | "NO_QUOTA" | "UNSUPPORTED";

type DeliveryPreview = {
  ruleKey: string;
  label: string;
  rule: {
    notificationEnabled: boolean;
    emailEnabled: boolean;
    wechatEnabled: boolean;
    emailSupported: boolean;
    wechatSupported: boolean;
  };
  mailLocalOutbox: boolean;
  recipients: Array<{
    userId: string;
    name: string;
    isCustomer: boolean;
    /** 外部门户联系人：无站内、无微信，只有邮件 */
    external: boolean;
    emailState: EmailState;
    wechatState: WechatState;
  }>;
  summary: {
    total: number;
    emailReady: number;
    emailUserOff: number;
    wechatReady: number;
    wechatUnavailable: number;
  };
};

/**
 * 发送前的提醒提示行 + 自定义弹窗。
 *
 * 默认态只读「本场景当前开着哪些通道」（与收件人无关，零逐人查询）；
 * 只有点开自定义才去算真实收件人和每人的通道状态。
 */
export function DeliveryNotice({
  scene,
  override,
  onOverrideChange,
  disabled,
}: {
  scene: DeliveryScene;
  override: NotificationDeliveryOverride;
  onOverrideChange: (next: NotificationDeliveryOverride) => void;
  disabled?: boolean;
}) {
  const rule = useDeliveryChannelRule(RULE_KEY_BY_SCENE[scene.scene]);
  const [open, setOpen] = useState(false);
  const channels = deliveryNoticeChannels(rule, override);
  const customized = isDeliveryOverrideActive(override, rule);

  if (!rule) return null;

  return (
    <>
      <Stack
        direction="row"
        spacing={1}
        sx={{
          color: "text.secondary",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <NotificationsActiveOutlinedIcon sx={{ fontSize: 16 }} />
        <Typography variant="caption">{deliveryNoticeText(channels)}</Typography>
        {customized ? (
          <Chip label="已自定义" size="small" color="warning" variant="outlined" />
        ) : null}
        <MuiLink
          component="button"
          type="button"
          variant="caption"
          underline="hover"
          disabled={disabled}
          onClick={() => setOpen(true)}
sx={{ border: 0, background: "none", p: 0, cursor: "pointer" }}
        >
          {customized ? "编辑" : "自定义"}
        </MuiLink>
      </Stack>

      {open ? (
        <DeliveryOverrideDialog
          scene={scene}
          override={override}
          onClose={() => setOpen(false)}
          onApply={(next) => {
            onOverrideChange(next);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function emailChipLabel(state: EmailState, on: boolean) {
  // 「本场景不发」是收件人范围，不是个人偏好 —— 强制覆盖不了，要说清楚
  if (state === "NOT_TARGETED") {
    return on ? "强制发送对此场景无效" : "本场景不发送";
  }
  if (!on) return "本次不发";
  return state === "USER_OFF" ? "强制发送" : "会收到";
}

function emailChipColor(state: EmailState, on: boolean) {
  if (!on || state === "NOT_TARGETED") return "default" as const;
  return state === "USER_OFF" ? ("warning" as const) : ("success" as const);
}

function wechatChipLabel(state: WechatState, on: boolean) {
  if (state === "NO_BINDING") return "未绑定小程序";
  if (state === "NO_QUOTA") return "订阅额度不足";
  if (state === "UNSUPPORTED") return "本场景无模板";
  return on ? "会收到" : "本次不发";
}

function DeliveryOverrideDialog({
  scene,
  override,
  onClose,
  onApply,
}: {
  scene: DeliveryScene;
  override: NotificationDeliveryOverride;
  onClose: () => void;
  onApply: (next: NotificationDeliveryOverride) => void;
}) {
  const [preview, setPreview] = useState<DeliveryPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<NotificationDeliveryOverride>(override);

  useEffect(() => {
    let active = true;
    staffApi<DeliveryPreview>(
      "/api/v1/notifications/delivery-preview",
      jsonRequest("POST", scene),
    )
      .then((data) => {
        if (active) setPreview(data);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error ? cause.message : "无法读取提醒范围",
          );
        }
      });
    return () => {
      active = false;
    };
    // scene 是纯数据对象，序列化后比较即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(scene)]);

  const resolved = useCallback(
    (channel: "notification" | "email" | "wechat") => {
      if (!preview) return false;
      const ruleValue =
        channel === "notification"
          ? preview.rule.notificationEnabled
          : channel === "email"
            ? preview.rule.emailEnabled
            : preview.rule.wechatEnabled;
      return draft[channel] ?? ruleValue;
    },
    [draft, preview],
  );

  const setChannel = (
    channel: "notification" | "email" | "wechat",
    value: boolean,
  ) => {
    if (!preview) return;
    const ruleValue =
      channel === "notification"
        ? preview.rule.notificationEnabled
        : channel === "email"
          ? preview.rule.emailEnabled
          : preview.rule.wechatEnabled;
    setDraft((current) => ({
      ...current,
      // 与规则一致就撤掉覆盖，别把「与默认相同」也记成一次覆盖
      [channel]: value === ruleValue ? undefined : value,
    }));
  };

  const notificationOn = resolved("notification");
  const excluded = new Set(draft.excludeUserIds ?? []);
  const forceWarning = preview
    ? emailForceWarning(preview, excluded, resolved("email"), notificationOn)
    : null;
  const toggleExcluded = (userId: string, keep: boolean) => {
    setDraft((current) => {
      const next = new Set(current.excludeUserIds ?? []);
      if (keep) next.delete(userId);
      else next.add(userId);
      return {
        ...current,
        excludeUserIds: next.size > 0 ? [...next] : undefined,
      };
    });
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>本次提醒方式</DialogTitle>
      <DialogContent dividers>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {!preview && !error ? (
          <Stack sx={{ alignItems: "center", py: 4 }}>
            <CircularProgress size={24} />
          </Stack>
        ) : null}

        {preview ? (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              场景「{preview.label}」。勾选优先于后台规则与个人设置，强制发送将记入审计。
            </Typography>

            <Box>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={notificationOn}
                    onChange={(event) =>
                      setChannel("notification", event.target.checked)
                    }
                  />
                }
                label={
                  <Stack>
                    <Typography variant="body2">站内通知（红点 + 消息列表）</Typography>
                    <Typography variant="caption" color="text.secondary">
                      通知的载体，关掉后邮件与微信订阅一并失效
                    </Typography>
                  </Stack>
                }
              />

              <Stack spacing={0.5} sx={{ pl: 4 }}>
                <FormControlLabel
                  disabled={!notificationOn || !preview.rule.emailSupported}
                  control={
                    <Checkbox
                      checked={notificationOn && resolved("email")}
                      onChange={(event) =>
                        setChannel("email", event.target.checked)
                      }
                    />
                  }
                  label={
                    <Stack>
                      <Typography variant="body2">邮件</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {preview.rule.emailSupported
                          ? emailHint(
                              preview,
                              excluded,
                              resolved("email"),
                              notificationOn,
                            )
                          : "本场景不支持邮件提醒"}
                      </Typography>
                    </Stack>
                  }
                />
                <FormControlLabel
                  disabled={!notificationOn || !preview.rule.wechatSupported}
                  control={
                    <Checkbox
                      checked={notificationOn && resolved("wechat")}
                      onChange={(event) =>
                        setChannel("wechat", event.target.checked)
                      }
                    />
                  }
                  label={
                    <Stack>
                      <Typography variant="body2">微信订阅</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {preview.rule.wechatSupported
                          ? wechatHint(
                              preview,
                              excluded,
                              resolved("wechat"),
                              notificationOn,
                            )
                          : "本场景无订阅模板"}
                      </Typography>
                    </Stack>
                  }
                />
              </Stack>
            </Box>

            {forceWarning ? (
              <Alert severity="warning">{forceWarning}</Alert>
            ) : null}

            {preview.mailLocalOutbox && resolved("email") ? (
              <Alert severity="warning">
                邮件当前是本地收件箱模式，勾选后只会写入本地发件箱，不会真正外发。
              </Alert>
            ) : null}

            <Divider />
            <Box>
              <Typography variant="subtitle2">
                收件人 {preview.recipients.length} 人 · 本次提醒{" "}
                {activeRecipients(preview, excluded).length} 人
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mb: 1 }}
              >
                取消勾选可将某人移出本次提醒，仅影响本次，不改动对方的通知设置。
              </Typography>
              {preview.recipients.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  本次没有需要提醒的人。
                </Typography>
              ) : (
                <Stack spacing={1}>
                  {recipientGroups(preview).map((group) => (
                    <Box key={group.key}>
                      <Chip
                        size="small"
                        label={group.title}
                        color={group.key === "customer" ? "primary" : "default"}
                        variant="outlined"
                        sx={{ mb: 1 }}
                      />
                      <Stack spacing={1}>
                      {group.rows.map((recipient) => (
                        <Stack
                          key={recipient.userId}
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: "center", flexWrap: "wrap" }}
                        >
                          <Checkbox
                            size="small"
                            sx={{ p: 0.5 }}
                            checked={
                              notificationOn && !excluded.has(recipient.userId)
                            }
                            disabled={!notificationOn}
                            onChange={(event) =>
                              toggleExcluded(recipient.userId, event.target.checked)
                            }
                            slotProps={{
                              input: { "aria-label": `提醒 ${recipient.name}` },
                            }}
                          />
                          <Typography
                            variant="body2"
                            sx={{
                              minWidth: 120,
                              textDecoration: excluded.has(recipient.userId)
                                ? "line-through"
                                : "none",
                              color: excluded.has(recipient.userId)
                                ? "text.disabled"
                                : "text.primary",
                            }}
                          >
                            {recipient.name}
                          </Typography>
                          {recipient.external ? (
                            <Chip
                              size="small"
                              variant="outlined"
                              label="外部联系人 · 仅邮件"
                            />
                          ) : null}
                          {excluded.has(recipient.userId) || !notificationOn ? (
                            <Chip
                              size="small"
                              label={
                                notificationOn ? "本次不提醒他" : "本次全部不提醒"
                              }
                            />
                          ) : (
                            <>
                              <Chip
                                size="small"
                                variant="outlined"
                                color={emailChipColor(
                                  recipient.emailState,
                                  resolved("email"),
                                )}
                                label={`邮件：${emailChipLabel(
                                  recipient.emailState,
                                  resolved("email"),
                                )}`}
                              />
                              {preview.rule.wechatSupported ? (
                                <Chip
                                  size="small"
                                  variant="outlined"
                                  color={
                                    recipient.wechatState === "READY" &&
                                    resolved("wechat")
                                      ? "success"
                                      : "default"
                                  }
                                  label={`微信：${wechatChipLabel(
                                    recipient.wechatState,
                                    resolved("wechat"),
                                  )}`}
                                />
                              ) : null}
                            </>
                          )}
                        </Stack>
                        ))}
                      </Stack>
                    </Box>
                  ))}
                </Stack>
              )}
            </Box>
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onApply({})}>恢复默认</Button>
        <Button onClick={onClose}>取消</Button>
        <Button
          variant="contained"
          disabled={!preview}
          onClick={() => preview && onApply(materializeDeliveryOverride(draft, preview.rule))}
        >
          应用
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** 客户与内部分开渲染，避免在长名单里点错人 */
function recipientGroups(preview: DeliveryPreview) {
  const customers = preview.recipients.filter((item) => item.isCustomer);
  const staff = preview.recipients.filter((item) => !item.isCustomer);
  return [
    ...(customers.length > 0
      ? [
          {
            key: "customer" as const,
            title: `客户 ${customers.length} 人`,
            rows: customers,
          },
        ]
      : []),
    ...(staff.length > 0
      ? [
          {
            key: "staff" as const,
            title: `内部人员 ${staff.length} 人`,
            rows: staff,
          },
        ]
      : []),
  ];
}

// 统计只算「本次真的会提醒」的人：排除掉的不能再计进各通道人数
function activeRecipients(preview: DeliveryPreview, excluded: Set<string>) {
  return preview.recipients.filter((item) => !excluded.has(item.userId));
}

function emailHint(
  preview: DeliveryPreview,
  excluded: Set<string>,
  on: boolean,
  notificationOn: boolean,
) {
  if (!notificationOn) return "站内通知已关闭，本次不发邮件";
  if (!on) return "已关闭：本次不发邮件";
  const active = activeRecipients(preview, excluded);
  const emailReady = active.filter((item) => item.emailState === "READY").length;
  const emailUserOff = active.filter(
    (item) => item.emailState === "USER_OFF",
  ).length;
  if (emailUserOff === 0) {
    return emailReady > 0
      ? `${emailReady} 人会收到`
      : "本次没有需要发邮件的收件人";
  }
  return `${emailReady} 人正常接收 · ${emailUserOff} 人已关闭`;
}

/** 开着邮件且有人自己关过 → 这个勾选此刻就是「强制发送」，必须说透 */
function emailForceWarning(
  preview: DeliveryPreview,
  excluded: Set<string>,
  on: boolean,
  notificationOn: boolean,
) {
  if (!on || !notificationOn) return null;
  const count = activeRecipients(preview, excluded).filter(
    (item) => item.emailState === "USER_OFF",
  ).length;
  if (count === 0) return null;
  return `${count} 人已关闭邮件提醒，保持勾选将强制发送并记入审计。`;
}

function wechatHint(
  preview: DeliveryPreview,
  excluded: Set<string>,
  on: boolean,
  notificationOn: boolean,
) {
  if (!notificationOn) return "站内通知已关闭，本次不发微信";
  if (!on) return "已关闭：本次不发微信订阅";
  const active = activeRecipients(preview, excluded);
  const wechatReady = active.filter(
    (item) => item.wechatState === "READY",
  ).length;
  const wechatUnavailable = active.filter(
    (item) =>
      item.wechatState === "NO_BINDING" || item.wechatState === "NO_QUOTA",
  ).length;
  const parts = [`${wechatReady} 人可送达`];
  if (wechatUnavailable > 0) {
    parts.push(`${wechatUnavailable} 人未绑定或额度耗尽（强制也发不出）`);
  }
  return parts.join(" · ");
}

export { DELIVERY_CHANNEL_LABELS };
