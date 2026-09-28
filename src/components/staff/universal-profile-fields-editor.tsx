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

function cleanCell(value: string) {
  return value.trim().replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, "").trim();
}

function isKey(value: string | undefined): value is string {
  return value !== undefined && KEY_PATTERN.test(value) && value.length <= 40;
}

/** 表格行：key、名称两列一组，名称后可选一列类型；一行可放多组 */
function parseCells(cells: string[]): ProfileField[] {
  const fields: ProfileField[] = [];
  let index = 0;
  while (index < cells.length) {
    const key = cells[index];
    if (!isKey(key)) {
      index += 1;
      continue;
    }
    const field: ProfileField = { key, label: cells[index + 1] ?? "", type: "text" };
    index += 2;
    // 名称后的类型别名可能正好也是下一组的 key（如 date）：只有它后面没有名称列时才当类型
    const typeAlias = typeAliases[cells[index] ?? ""];
    if (typeAlias && (index + 1 >= cells.length || isKey(cells[index + 1]))) {
      field.type = typeAlias;
      index += 1;
    }
    fields.push(field);
  }
  return fields;
}

/** 空白分隔的行：一行一个字段，「key 名称 [类型]」，名称可含空格 */
function parseWords(line: string): ProfileField | null {
  const words = line.trim().split(/\s+/).map(cleanCell).filter(Boolean);
  const key = words.shift()?.replace(/[:：]$/, "");
  if (!isKey(key)) return null;
  const typeAlias = words.length >= 2 ? typeAliases[words[words.length - 1]] : undefined;
  if (typeAlias) words.pop();
  return { key, label: words.join(" "), type: typeAlias ?? "text" };
}

/**
 * 把粘贴的清单解析成字段，逐行处理：
 * - 含 Tab 或竖线的行按列解析（直接粘贴表格），表头和分隔线自动跳过；
 * - 其余行按「key 名称 [类型]」解析。
 */
export function parseProfileFieldText(text: string): ProfileField[] {
  const fields: ProfileField[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (/[\t|]/.test(line)) {
      const cells = line.split(/[\t|]/).map(cleanCell);
      if (line.trim().startsWith("|")) cells.shift();
      if (line.trim().endsWith("|")) cells.pop();
      fields.push(...parseCells(cells));
    } else {
      const field = parseWords(line);
      if (field) fields.push(field);
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
              每行一个字段，写成「字段 key 显示名称」，可在名称后加类型（文本 / 数字 / 布尔值 / 日期，默认文本）。也可以直接粘贴 Tab 分隔或 Markdown 表格，一行可放多组。已有的同名 key 会被覆盖。
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
