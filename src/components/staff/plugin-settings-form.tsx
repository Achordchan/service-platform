"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { Button, FormControlLabel, Stack, Switch, TextField } from "@mui/material";
import type { PluginView } from "@/components/staff/plugin-center";

type PluginSettingsValues = {
  config: Record<string, unknown>;
  secrets: Record<string, string | undefined>;
};

function createPluginSettingsSchema(plugin: PluginView) {
  return z
    .object({
      config: z.record(z.string(), z.unknown()),
      secrets: z.record(z.string(), z.string().optional()),
    })
    .superRefine((values, context) => {
      for (const field of plugin.settings) {
        const value = values.config[field.key];
        const stringValue = String(value ?? "").trim();
        const path = ["config", field.key];

        if (
          (field.type === "secret-url" || field.type === "secret-text")
        ) {
          const secret = values.secrets[field.key]?.trim() ?? "";
          if (
            field.required &&
            !plugin.configuredSecretKeys.includes(field.key) &&
            !secret
          ) {
            context.addIssue({
              code: "custom",
              path: ["secrets", field.key],
              message: `请填写${field.label}`,
            });
          }
          continue;
        }

        if (field.type === "number") {
          if (value === undefined || value === null || value === "") {
            if (field.required) {
              context.addIssue({
                code: "custom",
                path,
                message: `请填写${field.label}`,
              });
            }
            continue;
          }
          if (typeof value !== "number" || !Number.isFinite(value)) {
            context.addIssue({
              code: "custom",
              path,
              message: `${field.label}必须是数字`,
            });
            continue;
          }
          if (field.min !== undefined && value < field.min) {
            context.addIssue({
              code: "custom",
              path,
              message: `${field.label}不能小于 ${field.min}`,
            });
          }
          if (field.max !== undefined && value > field.max) {
            context.addIssue({
              code: "custom",
              path,
              message: `${field.label}不能大于 ${field.max}`,
            });
          }
          continue;
        }
        if (field.required && !stringValue) {
          context.addIssue({
            code: "custom",
            path,
            message: `请填写${field.label}`,
          });
        }
        if (field.type === "url" && stringValue) {
          try {
            new URL(stringValue);
          } catch {
            context.addIssue({
              code: "custom",
              path,
              message: `${field.label}必须是有效 URL`,
            });
          }
        }
      }
    });
}

export function PluginSettingsForm({
  plugin,
  initialConfig,
  initialSecrets,
  busy,
  onSave,
}: {
  plugin: PluginView;
  initialConfig: Record<string, unknown>;
  initialSecrets: Record<string, string>;
  busy: boolean;
  onSave: (
    config: Record<string, unknown>,
    secrets: Record<string, string>,
  ) => Promise<boolean | void>;
}) {
  const schema = useMemo(() => createPluginSettingsSchema(plugin), [plugin]);
  const form = useForm<PluginSettingsValues>({
    resolver: zodResolver(schema),
    defaultValues: { config: initialConfig, secrets: initialSecrets },
    mode: "onChange",
  });

  const submit = form.handleSubmit(async (values) => {
    const secrets = Object.fromEntries(
      Object.entries(values.secrets).filter(
        ([, value]) => typeof value === "string" && value.trim().length > 0,
      ),
    ) as Record<string, string>;
    const saved = await onSave(values.config, secrets);
    if (saved === true) {
      form.reset({ config: values.config, secrets: {} });
    }
  });

  return (
    <Stack spacing={2} component="form" noValidate onSubmit={submit}>
      {plugin.settings.map((field) => {
        const configName = `config.${field.key}` as never;
        const secretName = `secrets.${field.key}` as never;
        if (field.type === "boolean") {
          return (
            <Controller
              key={field.key}
              name={configName}
              control={form.control}
              render={({ field: controllerField }) => (
                <FormControlLabel
                  control={
                    <Switch
                      checked={Boolean(controllerField.value)}
                      onChange={(_, checked) => controllerField.onChange(checked)}
                    />
                  }
                  label={field.label}
                />
              )}
            />
          );
        }
        if (field.type === "secret-url" || field.type === "secret-text") {
          return (
            <Controller
              key={field.key}
              name={secretName}
              control={form.control}
                render={({ field: controllerField, fieldState }) => (
                  <TextField
                    {...controllerField}
                    value={controllerField.value ?? ""}
                    type="password"
                  label={field.label}
                  helperText={
                    fieldState.error?.message ??
                    (plugin.configuredSecretKeys.includes(field.key)
                      ? "已加密保存；留空表示不修改"
                      : field.description)
                  }
                  error={Boolean(fieldState.error)}
                  autoComplete="new-password"
                  required={
                    field.required &&
                    !plugin.configuredSecretKeys.includes(field.key)
                  }
                  fullWidth
                />
              )}
            />
          );
        }
        return (
          <Controller
            key={field.key}
            name={configName}
            control={form.control}
            render={({ field: controllerField, fieldState }) => (
              <TextField
                {...controllerField}
                type={field.type === "number" ? "number" : field.type === "url" ? "url" : "text"}
                label={field.label}
                value={
                  field.type === "number"
                    ? controllerField.value === undefined ||
                      controllerField.value === null ||
                      controllerField.value === ""
                      ? ""
                      : Number(controllerField.value)
                    : String(controllerField.value ?? "")
                }
                onChange={(event) =>
                  controllerField.onChange(
                    field.type === "number"
                      ? event.target.value === ""
                        ? ""
                        : Number(event.target.value)
                      : event.target.value,
                  )
                }
                helperText={fieldState.error?.message ?? field.description}
                error={Boolean(fieldState.error)}
                placeholder={field.placeholder}
                required={field.required}
                slotProps={{
                  htmlInput: {
                    min: field.min,
                    max: field.max,
                    step: field.step ?? 1,
                  },
                }}
                fullWidth
              />
            )}
          />
        );
      })}
      <Button type="submit" variant="contained" disabled={busy}>
        {busy ? "保存中" : "保存配置"}
      </Button>
    </Stack>
  );
}
