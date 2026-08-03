"use client";

import { useMemo } from "react";
import {
  Button,
  IconButton,
  type ButtonProps,
  type IconButtonProps,
} from "@mui/material";
import {
  ErrorCode,
  useDropzone,
  type Accept,
  type FileRejection,
} from "react-dropzone";

export const IMAGE_FILE_ACCEPT: Accept = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
};

type FilePickerOptions = {
  accept?: Accept | string;
  multiple?: boolean;
  maxSize?: number;
  maxFiles?: number;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  onRejected?: (rejections: FileRejection[]) => void;
  dropLabel?: React.ReactNode;
};

type FilePickerButtonProps = FilePickerOptions &
  Omit<ButtonProps, "component" | "onDrop">;

type FilePickerIconButtonProps = FilePickerOptions &
  Omit<IconButtonProps, "component" | "onDrop">;

function normalizeAccept(accept?: Accept | string): Accept | undefined {
  if (accept === undefined) return undefined;
  if (typeof accept !== "string") return accept as Accept;
  const mimeTypes: Accept = {};
  const extensions: string[] = [];
  for (const token of accept.split(",").map((item) => item.trim()).filter(Boolean)) {
    if (token.startsWith(".")) extensions.push(token.toLowerCase());
    else mimeTypes[token] = [];
  }
  if (extensions.length > 0) {
    mimeTypes["application/octet-stream"] = extensions;
  }
  return Object.keys(mimeTypes).length > 0 ? mimeTypes : undefined;
}

function useFilePicker({
  accept,
  multiple = false,
  maxSize,
  maxFiles,
  disabled,
  onFiles,
  onRejected,
}: FilePickerOptions) {
  const normalizedAccept = useMemo(() => normalizeAccept(accept), [accept]);
  return useDropzone({
    accept: normalizedAccept,
    multiple,
    maxSize,
    maxFiles,
    disabled,
    getErrorMessage: (error, file) => {
      if (error.code === ErrorCode.FileInvalidType) {
        return `${file.name} 的文件类型不受支持`;
      }
      if (error.code === ErrorCode.FileTooLarge) {
        return `${file.name} 超过允许的文件大小`;
      }
      if (error.code === ErrorCode.TooManyFiles) {
        return "选择的文件数量过多";
      }
      return error.message;
    },
    onDropAccepted: onFiles,
    onDropRejected: onRejected,
  });
}

export function firstFileRejectionMessage(rejections: FileRejection[]) {
  return rejections[0]?.errors[0]?.message ?? "文件选择失败";
}

export function FilePickerButton({
  accept,
  multiple,
  maxSize,
  maxFiles,
  disabled,
  onFiles,
  onRejected,
  dropLabel = "松开以添加文件",
  children,
  ...buttonProps
}: FilePickerButtonProps) {
  const { getRootProps, getInputProps, isDragActive } = useFilePicker({
    accept,
    multiple,
    maxSize,
    maxFiles,
    disabled,
    onFiles,
    onRejected,
  });
  const rootProps = getRootProps({
    ...buttonProps,
    role: "button",
  });

  return (
    <Button {...rootProps} disabled={disabled}>
      <input {...getInputProps({ "aria-hidden": true })} />
      {isDragActive ? dropLabel : children}
    </Button>
  );
}

export function FilePickerIconButton({
  accept,
  multiple,
  maxSize,
  maxFiles,
  disabled,
  onFiles,
  onRejected,
  children,
  ...buttonProps
}: FilePickerIconButtonProps) {
  const { getRootProps, getInputProps, isDragActive } = useFilePicker({
    accept,
    multiple,
    maxSize,
    maxFiles,
    disabled,
    onFiles,
    onRejected,
  });
  const rootProps = getRootProps({
    ...buttonProps,
    role: "button",
  });

  return (
    <IconButton
      {...rootProps}
      color={isDragActive ? "primary" : buttonProps.color}
      disabled={disabled}
    >
      <input {...getInputProps({ "aria-hidden": true })} />
      {children}
    </IconButton>
  );
}
