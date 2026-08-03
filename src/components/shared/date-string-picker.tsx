"use client";

import { useState, type FocusEventHandler, type ReactNode, type Ref } from "react";
import { format, isValid, parseISO } from "date-fns";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import type { DateValidationError } from "@mui/x-date-pickers/models";

const DATE_INPUT_FORMAT = "yyyy-MM-dd";
const DATE_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function parseDateString(value?: string | null) {
  if (!value || !DATE_INPUT_PATTERN.test(value)) return null;
  const parsed = parseISO(value);
  return isValid(parsed) && format(parsed, DATE_INPUT_FORMAT) === value
    ? parsed
    : null;
}

export function formatDateString(value?: Date | null) {
  return value && isValid(value) ? format(value, DATE_INPUT_FORMAT) : "";
}

function dateValidationMessage(error: DateValidationError) {
  switch (error) {
    case "invalidDate":
      return "请输入有效日期";
    case "minDate":
      return "日期不能早于开始日期";
    case "maxDate":
      return "日期不能晚于结束日期";
    case null:
      return "";
    default:
      return "该日期不可用";
  }
}

export function DateStringPicker({
  label,
  value,
  onChange,
  onBlur,
  name,
  inputRef,
  minDate,
  maxDate,
  disabled,
  required,
  error,
  helperText,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: FocusEventHandler;
  name?: string;
  inputRef?: Ref<HTMLInputElement>;
  minDate?: string;
  maxDate?: string;
  disabled?: boolean;
  required?: boolean;
  error?: boolean;
  helperText?: ReactNode;
}) {
  const [pickerError, setPickerError] = useState("");

  return (
    <DatePicker
      label={label}
      value={parseDateString(value)}
      onChange={(nextValue) => {
        if (nextValue === null) {
          onChange("");
          return;
        }
        if (isValid(nextValue)) onChange(formatDateString(nextValue));
      }}
      onError={(nextError) => {
        setPickerError(dateValidationMessage(nextError));
      }}
      format={DATE_INPUT_FORMAT}
      minDate={parseDateString(minDate) ?? undefined}
      maxDate={parseDateString(maxDate) ?? undefined}
      disabled={disabled}
      name={name}
      inputRef={inputRef}
      slotProps={{
        field: {
          clearable: true,
          onBlur,
        },
        textField: {
          fullWidth: true,
          required,
          error: Boolean(error || pickerError),
          helperText: helperText || pickerError || undefined,
        },
      }}
    />
  );
}
