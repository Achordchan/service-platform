"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Box,
  Button,
  Collapse,
  Divider,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import { useToast } from "@/components/shared/toast-provider";
import { apiRequest, jsonRequest } from "@/lib/api-client";
import { NOTIFICATION_DELIVERY_RULES } from "@/modules/notifications/notification-delivery-rules";

type Preferences = {
  soundNotificationsEnabled: boolean;
  requestEmailNotificationsEnabled: boolean;
};

type PerTypePreference = {
  ruleKey: string;
  emailEnabled: boolean;
};

type RuleMeta = { category: string; label: string; description: string };

function buildRuleMeta(audience: "CUSTOMER" | "STAFF"): Record<string, RuleMeta> {
  return Object.fromEntries(
    NOTIFICATION_DELIVERY_RULES.map((rule) => [
      rule.key,
      {
        category: rule.category,
        label: rule.label,
        // 客户视角使用面向客户的描述，避免出现钉钉等员工端渠道文案
        description:
          audience === "CUSTOMER" &&
          "descriptionCustomer" in rule &&
          rule.descriptionCustomer
            ? rule.descriptionCustomer
            : rule.description,
      },
    ]),
  );
}

const CATEGORIES = ["项目交付", "服务请求", "内容风控"] as const;

function groupByCategory(
  items: PerTypePreference[],
  ruleMeta: Record<string, RuleMeta>,
  categories: readonly string[],
) {
  const groups: Record<string, PerTypePreference[]> = {};
  for (const cat of categories) groups[cat] = [];
  for (const item of items) {
    const meta = ruleMeta[item.ruleKey];
    if (meta) {
      groups[meta.category]?.push(item);
    }
  }
  return groups;
}

export function NotificationPreferencesForm({
  initialPreferences,
  initialPerType = [],
  audience = "STAFF",
}: {
  initialPreferences: Preferences;
  initialPerType?: PerTypePreference[];
  audience?: "CUSTOMER" | "STAFF";
}) {
  const toast = useToast();
  const ruleMeta = buildRuleMeta(audience);
  const categories: readonly string[] =
    audience === "CUSTOMER"
      ? CATEGORIES.filter((cat) => cat !== "内容风控")
      : CATEGORIES;
  const [preferences, setPreferences] = useState(initialPreferences);
  const [perType, setPerType] = useState<PerTypePreference[]>(initialPerType);
  const [pendingRuleKeys, setPendingRuleKeys] = useState<Set<string>>(
    new Set(),
  );

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

  const perTypeMutation = useMutation({
    mutationFn: (input: PerTypePreference) =>
      apiRequest<PerTypePreference>(
        "/api/v1/me/notification-preferences/rules",
        jsonRequest("PUT", input),
        "通知类型设置保存失败",
      ),
    onError: (saveError) => {
      toast.error(saveError instanceof Error ? saveError.message : "保存失败");
    },
  });

  function save() {
    saveMutation.mutate(preferences);
  }

  function togglePerType(ruleKey: string, emailEnabled: boolean) {
    if (pendingRuleKeys.has(ruleKey)) return;
    setPendingRuleKeys((prev) => new Set(prev).add(ruleKey));
    setPerType((prev) =>
      prev.map((item) =>
        item.ruleKey === ruleKey ? { ...item, emailEnabled } : item,
      ),
    );
    perTypeMutation.mutate(
      { ruleKey, emailEnabled },
      {
        onError: () => {
          setPerType((prev) =>
            prev.map((item) =>
              item.ruleKey === ruleKey
                ? { ...item, emailEnabled: !emailEnabled }
                : item,
            ),
          );
        },
        onSettled: () => {
          setPendingRuleKeys((prev) => {
            const next = new Set(prev);
            next.delete(ruleKey);
            return next;
          });
        },
      },
    );
  }

  const grouped = groupByCategory(perType, ruleMeta, categories);
  const emailMasterEnabled = preferences.requestEmailNotificationsEnabled;

  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
      <Stack spacing={2}>
        <div>
          <Typography sx={{ fontWeight: 650 }}>通知设置</Typography>
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
              checked={emailMasterEnabled}
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

        {perType.length > 0 && (
          <>
            <Divider />
            <div>
              <Typography sx={{ fontWeight: 650 }}>
                按类型管理邮件通知
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.5 }}
              >
                在总开关开启时，可单独关闭特定类型的邮件通知。
              </Typography>
            </div>
            <Collapse in={emailMasterEnabled}>
              <Stack spacing={2}>
                {categories.map((category) => {
                  const items = grouped[category];
                  if (!items || items.length === 0) return null;
                  return (
                    <Box key={category}>
                      <Typography
                        variant="body2"
                        sx={{ fontWeight: 650, color: "text.secondary", mb: 1 }}
                      >
                        {category}
                      </Typography>
                      <Stack spacing={0.5} sx={{ pl: 0.5 }}>
                        {items.map((item) => {
                          const meta = ruleMeta[item.ruleKey];
                          return (
                            <FormControlLabel
                              key={item.ruleKey}
                              control={
                                <Switch
                                  size="small"
                                  checked={item.emailEnabled}
                                  disabled={pendingRuleKeys.has(item.ruleKey)}
                                  onChange={(e) =>
                                    togglePerType(
                                      item.ruleKey,
                                      e.target.checked,
                                    )
                                  }
                                />
                              }
                              label={
                                <Box>
                                  <Typography variant="body2">
                                    {meta?.label ?? item.ruleKey}
                                  </Typography>
                                  {meta?.description && (
                                    <Typography
                                      variant="caption"
                                      color="text.secondary"
                                    >
                                      {meta.description}
                                    </Typography>
                                  )}
                                </Box>
                              }
                            />
                          );
                        })}
                      </Stack>
                    </Box>
                  );
                })}
              </Stack>
            </Collapse>
            {!emailMasterEnabled && (
              <Typography variant="body2" color="text.secondary">
                请先开启「业务通知邮件」总开关以管理各类型邮件。
              </Typography>
            )}
          </>
        )}
      </Stack>
    </Paper>
  );
}
