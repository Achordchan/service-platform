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

// 字典是普通对象，粘贴内容里的 constructor、toString 等词不能命中原型链上的属性
function ownValue<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function cleanCell(value: string) {
  return value.trim().replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, "").trim();
}

function isKey(value: string | undefined): value is string {
  return value !== undefined && KEY_PATTERN.test(value) && value.length <= 40;
}

type ColumnRole = "key" | "label" | "type";

const headerRoles: Record<string, ColumnRole> = {
  key: "key",
  field: "key",
  字段: "key",
  字段名: "key",
  字段key: "key",
  label: "label",
  name: "label",
  名称: "label",
  标签: "label",
  显示名称: "label",
  type: "type",
  类型: "type",
  字段类型: "type",
};

// 纯文本行只认中文类型词，免得 “Release date” 这类英文名称被截掉最后一个词
const wordTypeAliases: Record<string, ProfileField["type"]> = {
  文本: "text",
  数字: "number",
  布尔: "boolean",
  布尔值: "boolean",
  日期: "date",
};

function headerRoleOf(cell: string) {
  return ownValue(headerRoles, cell.toLowerCase().replace(/\s+/g, ""));
}

/**
 * 把列按角色切成组：同一角色再次出现就开始新的一组，所以列顺序不限
 * （key|名称、名称|key|类型、key|名称|key|名称 都行）。每组必须恰好有一个 key 列。
 */
function groupColumns(roles: ColumnRole[]): number[][] | null {
  const groups: number[][] = [];
  let current: number[] = [];
  for (const [index, role] of roles.entries()) {
    if (current.some((column) => roles[column] === role)) {
      groups.push(current);
      current = [];
    }
    current.push(index);
  }
  if (current.length) groups.push(current);
  return groups.every((group) => group.some((column) => roles[column] === "key"))
    ? groups
    : null;
}

/** 整行都是表头词且能切成合法列组才算表头，返回每列的角色 */
function parseHeader(cells: string[]): ColumnRole[] | null {
  const roles = cells.map(headerRoleOf);
  if (!roles.every(Boolean)) return null;
  return groupColumns(roles as ColumnRole[]) ? (roles as ColumnRole[]) : null;
}

/** 行尾的空单元格可多可少（表格软件复制常带多余 Tab），按列数补齐或截掉 */
function fitCells(cells: string[], length: number) {
  if (cells.length > length && cells.slice(length).some(Boolean)) return null;
  return Array.from({ length }, (_, index) => cells[index] ?? "");
}

/** 按列角色切组解析一行；某组不合规则整行作废（返回 null），整组为空的直接跳过 */
function parseRowWithRoles(rawCells: string[], roles: ColumnRole[]) {
  const cells = fitCells(rawCells, roles.length);
  const groups = groupColumns(roles);
  if (!cells || !groups) return null;
  const fields: ProfileField[] = [];
  for (const group of groups) {
    if (group.every((column) => !cells[column])) continue;
    const value = (role: ColumnRole) =>
      cells[group.find((column) => roles[column] === role) ?? -1] ?? "";
    const key = value("key");
    const typeCell = value("type");
    const type = typeCell ? ownValue(typeAliases, typeCell) : "text";
    if (!isKey(key) || !type) return null;
    fields.push({ key, label: value("label"), type });
  }
  return fields;
}

function rolesForWidth(width: 2 | 3, length: number): ColumnRole[] {
  const unit: ColumnRole[] = width === 3 ? ["key", "label", "type"] : ["key", "label"];
  return Array.from({ length }, (_, index) => unit[index % width]);
}

/**
 * 无表头的表格行：每组固定 2 列（key、名称）或 3 列（key、名称、类型，最后一组可省类型），行尾空单元格不计。
 * 只有一种宽度能完整合法地切开、或两种切法结果相同时才采用；有歧义或都不行时不猜。
 */
function parseRowWithoutHeader(rawCells: string[]) {
  const cells = [...rawCells];
  while (cells.length && !cells[cells.length - 1]) cells.pop();
  if (cells.length === 1) {
    return isKey(cells[0]) ? [{ key: cells[0], label: "", type: "text" as const }] : null;
  }
  // 2 列一组必须整除；3 列一组时最后一组可以省掉类型列
  const candidates = ([2, 3] as const)
    .filter((width) =>
      width === 2 ? cells.length % 2 === 0 : cells.length % 3 !== 1,
    )
    .map((width) =>
      parseRowWithRoles(
        cells,
        rolesForWidth(width, Math.ceil(cells.length / width) * width),
      ),
    )
    .filter((fields): fields is ProfileField[] => fields !== null && fields.length > 0);
  const distinct = new Set(candidates.map((fields) => JSON.stringify(fields)));
  return distinct.size === 1 ? candidates[0] : null;
}

/** 纯文本行：一行一个字段，「key 名称 [类型]」，名称可含空格 */
function parseWords(line: string): ProfileField | null {
  const words = line.trim().split(/\s+/).map(cleanCell).filter(Boolean);
  const key = words.shift()?.replace(/[:：]$/, "");
  if (!isKey(key)) return null;
  const typeAlias =
    words.length >= 2 ? ownValue(wordTypeAliases, words[words.length - 1]) : undefined;
  if (typeAlias) words.pop();
  return { key, label: words.join(" "), type: typeAlias ?? "text" };
}

function splitTableRow(line: string) {
  const cells = line.split(/[\t|]/).map(cleanCell);
  if (line.trim().startsWith("|")) cells.shift();
  if (line.trim().endsWith("|")) cells.pop();
  return cells;
}

/**
 * 把粘贴的清单解析成字段，逐行处理：
 * - 含 Tab 或竖线的行是表格：一段的第一行是表头（key/label/type 或 字段名/标签/类型）就按它定列，
 *   没有表头时按每组 2 列或 3 列切分；分隔线跳过；
 * - 其余行按「key 名称 [类型]」一行一个；
 * - 识别不了或有歧义的行不猜，行号放进 skippedLines；当作表头忽略的行放进 headerLines，都交给界面提示。
 */
export function parseProfileFieldText(text: string) {
  const fields: ProfileField[] = [];
  const skippedLines: number[] = [];
  const headerLines: number[] = [];
  let roles: ColumnRole[] | null = null;
  // 表头只可能是一段（空行分隔）的第一行；之后的行一律当数据，哪怕单元格恰好是表头词
  let blockStarted = false;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) {
      roles = null;
      blockStarted = false;
      continue;
    }
    const atBlockStart = !blockStarted;
    let parsed: ProfileField[] | null;
    if (/[\t|]/.test(line)) {
      const cells = splitTableRow(line);
      if (cells.every((cell) => /^:?-*:?$/.test(cell))) continue;
      blockStarted = true;
      const header = atBlockStart ? parseHeader(cells) : null;
      if (header) {
        roles = header;
        headerLines.push(index + 1);
        continue;
      }
      parsed = roles ? parseRowWithRoles(cells, roles) : parseRowWithoutHeader(cells);
    } else {
      const words = line.trim().split(/\s+/).map(cleanCell).filter(Boolean);
      blockStarted = true;
      if (atBlockStart && parseHeader(words)) {
        headerLines.push(index + 1);
        continue;
      }
      const field = parseWords(line);
      parsed = field ? [field] : null;
    }
    if (parsed) fields.push(...parsed);
    else skippedLines.push(index + 1);
  }
  // 同一 key 出现多次时以最后一次为准，位置保留第一次出现处
  const byKey = new Map<string, ProfileField>();
  for (const field of fields) {
    byKey.set(field.key, {
      ...field,
      label: (field.label || field.key).slice(0, 60),
    });
  }
  return { fields: [...byKey.values()], skippedLines, headerLines };
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
  const { fields: parsed, skippedLines, headerLines } =
    parseProfileFieldText(pasteText);
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
              每行一个字段，写成「字段 key 显示名称」，可在名称后加类型（文本 / 数字 / 布尔值 / 日期，默认文本）。也可以直接粘贴 Tab 分隔或 Markdown 表格，一行可放多组，带表头时按表头认列。已有的同名 key 会被覆盖。
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
            ) : null}
            {headerLines.length ? (
              <Alert severity="info">
                第 {headerLines.join("、")} 行识别为表头，未导入。如果它其实是字段，请把它挪到非首行或删掉上方空行。
              </Alert>
            ) : null}
            {skippedLines.length ? (
              <Alert severity="warning">
                第 {skippedLines.join("、")} 行无法识别，已跳过。字段 key 需要小写字母开头；表格每组按「key、名称」或「key、名称、类型」排列，列数对不上时请加上表头。
              </Alert>
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
