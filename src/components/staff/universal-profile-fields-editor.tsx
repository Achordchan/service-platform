"use client";

import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import ContentPasteOutlinedIcon from "@mui/icons-material/ContentPasteOutlined";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";

export type ProfileField = {
  key: string;
  label: string;
  type: "text" | "number" | "boolean" | "date";
};

export const MAX_PROFILE_FIELDS = 10;
const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

const typeLabels: Record<ProfileField["type"], string> = {
  text: "文本",
  number: "数字",
  boolean: "布尔值",
  date: "日期",
};

const typeAliases: Record<string, ProfileField["type"]> = {
  文本: "text",
  text: "text",
  数字: "number",
  number: "number",
  布尔: "boolean",
  布尔值: "boolean",
  boolean: "boolean",
  日期: "date",
  date: "date",
};

/**
 * 把粘贴的清单解析成字段：任何分隔符（空白、Tab、竖线、逗号、冒号）都行，
 * 符合 key 规则的词开始一个新字段，后面的词是它的显示名称，名称后可跟类型。
 * 一行放多组（如 Markdown 表格的四列）也能拆开；表头、分隔线等无主词会被忽略。
 */
export function parseProfileFieldText(text: string): ProfileField[] {
  const fields: ProfileField[] = [];
  let current: ProfileField | null = null;
  for (const raw of text.split(/[\s|,，;；:：]+/)) {
    const token = raw.replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, "");
    if (!token || /^-+$/.test(token)) continue;
    const typeAlias = typeAliases[token];
    if (current?.label && typeAlias) {
      current.type = typeAlias;
    } else if (KEY_PATTERN.test(token) && token.length <= 40) {
      current = { key: token, label: "", type: "text" };
      fields.push(current);
    } else if (current) {
      current.label = current.label ? `${current.label} ${token}` : token;
    }
  }
  return fields.map((field) => ({
    ...field,
    label: (field.label || field.key).slice(0, 60),
  }));
}

/** 同 key 覆盖名称和类型，新 key 追加到末尾；空白行一并清掉 */
export function mergeProfileFields(
  existing: ProfileField[],
  incoming: ProfileField[],
) {
  const merged = existing.filter((field) => field.key.trim());
  let added = 0;
  let updated = 0;
  for (const field of incoming) {
    const index = merged.findIndex((item) => item.key === field.key);
    if (index === -1) {
      merged.push(field);
      added += 1;
    } else if (
      merged[index].label !== field.label ||
      merged[index].type !== field.type
    ) {
      merged[index] = field;
      updated += 1;
    }
  }
  return { fields: merged, added, updated };
}

function keyError(fields: ProfileField[], index: number) {
  const key = fields[index].key.trim();
  if (!key) return "必填";
  if (!KEY_PATTERN.test(key)) return "小写字母开头，只能含小写字母、数字、下划线";
  if (fields.findIndex((field) => field.key.trim() === key) !== index) {
    return "字段 key 重复";
  }
  return null;
}

export function profileFieldsValid(fields: ProfileField[]) {
  return fields.every(
    (field, index) => !keyError(fields, index) && field.label.trim(),
  );
}

export function UniversalProfileFieldsEditor({
  fields,
  onChange,
  disabled,
  readOnly,
}: {
  fields: ProfileField[];
  onChange: (fields: ProfileField[]) => void;
  disabled: boolean;
  readOnly: boolean;
}) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const parsed = parseProfileFieldText(pasteText);
  const preview = mergeProfileFields(fields, parsed);
  const overLimit = preview.fields.length > MAX_PROFILE_FIELDS;

  function updateField(index: number, patch: Partial<ProfileField>) {
    onChange(
      fields.map((field, itemIndex) =>
        itemIndex === index ? { ...field, ...patch } : field,
      ),
    );
  }

  function closePaste() {
    setPasteOpen(false);
    setPasteText("");
  }

  return (
    <Stack spacing={1.5}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="h3">用户自定义资料</Typography>
          <Chip
            size="small"
            variant="outlined"
            label={`${fields.length} / ${MAX_PROFILE_FIELDS}`}
          />
        </Stack>
        {readOnly ? null : (
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              startIcon={<ContentPasteOutlinedIcon />}
              onClick={() => setPasteOpen(true)}
              disabled={disabled}
            >
              批量粘贴
            </Button>
            <Button
              size="small"
              startIcon={<AddOutlinedIcon />}
              onClick={() =>
                onChange([...fields, { key: "", label: "", type: "text" }])
              }
              disabled={disabled || fields.length >= MAX_PROFILE_FIELDS}
            >
              添加字段
            </Button>
          </Stack>
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary">
        外部系统签发票据时可以附带这些用户资料，未声明的字段会被拒绝。字段有改动时，保存后需要重新检测并激活连接。
      </Typography>
      {fields.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
          尚未声明资料字段。
        </Typography>
      ) : null}
      {fields.map((field, index) => {
        const touched = Boolean(field.key || field.label);
        const error = touched ? keyError(fields, index) : null;
        const labelError = touched && !field.label.trim() ? "必填" : null;
        return (
          <Box
            key={index}
            sx={(theme) => ({
              display: "grid",
              gridTemplateColumns: "1fr 1fr 140px 40px",
              gap: 1,
              alignItems: "start",
              [theme.breakpoints.down("md")]: {
                gridTemplateColumns: "1fr 1fr",
                pb: 1.5,
                borderBottom: `1px solid ${theme.palette.divider}`,
              },
            })}
          >
            <TextField
              size="small"
              label="字段 key"
              value={field.key}
              onChange={(event) => updateField(index, { key: event.target.value })}
              error={Boolean(error)}
              helperText={error}
              disabled={readOnly || disabled}
            />
            <TextField
              size="small"
              label="显示名称"
              value={field.label}
              onChange={(event) =>
                updateField(index, { label: event.target.value })
              }
              error={Boolean(labelError)}
              helperText={labelError}
              disabled={readOnly || disabled}
            />
            <TextField
              select
              size="small"
              label="类型"
              value={field.type}
              onChange={(event) =>
                updateField(index, {
                  type: event.target.value as ProfileField["type"],
                })
              }
              disabled={readOnly || disabled}
            >
              {Object.entries(typeLabels).map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </TextField>
            {readOnly ? null : (
              <IconButton
                aria-label="删除资料字段"
                onClick={() =>
                  onChange(fields.filter((_, itemIndex) => itemIndex !== index))
                }
                disabled={disabled}
                sx={{ justifySelf: { xs: "end", md: "auto" } }}
              >
                <DeleteOutlineOutlinedIcon />
              </IconButton>
            )}
          </Box>
        );
      })}

      <Dialog open={pasteOpen} onClose={closePaste} fullWidth maxWidth="sm">
        <DialogTitle>批量粘贴资料字段</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              每个字段写成「字段 key 显示名称」，可在名称后加类型（文本 / 数字 / 布尔值 / 日期，默认文本）。直接粘贴表格也行。已有的同名 key 会被覆盖。
            </Typography>
            <TextField
              label="字段清单"
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
              multiline
              minRows={6}
              placeholder={"app_version 客户端版本\nos 系统\ntimezone 时区"}
              autoFocus
            />
            {parsed.length ? (
              <Stack spacing={0.75}>
                <Typography variant="subtitle2">
                  识别到 {parsed.length} 个字段：新增 {preview.added} 个，更新 {preview.updated} 个
                </Typography>
                <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.75 }}>
                  {parsed.map((field) => (
                    <Chip
                      key={field.key}
                      size="small"
                      label={`${field.key} · ${field.label} · ${typeLabels[field.type]}`}
                    />
                  ))}
                </Stack>
              </Stack>
            ) : pasteText.trim() ? (
              <Alert severity="warning">没有识别到字段，字段 key 需要小写字母开头。</Alert>
            ) : null}
            {overLimit ? (
              <Alert severity="error">
                合并后共 {preview.fields.length} 个字段，超过上限 {MAX_PROFILE_FIELDS} 个，请先删掉一些。
              </Alert>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closePaste}>取消</Button>
          <Button
            variant="contained"
            disabled={!parsed.length || overLimit}
            onClick={() => {
              onChange(preview.fields);
              closePaste();
            }}
          >
            填入
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
