"use client";

import { useEffect, useRef, useState } from "react";
import {
  Box,
  CircularProgress,
  Divider,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import FormatBoldOutlinedIcon from "@mui/icons-material/FormatBoldOutlined";
import FormatItalicOutlinedIcon from "@mui/icons-material/FormatItalicOutlined";
import FormatListBulletedOutlinedIcon from "@mui/icons-material/FormatListBulletedOutlined";
import FormatListNumberedOutlinedIcon from "@mui/icons-material/FormatListNumberedOutlined";
import LinkOutlinedIcon from "@mui/icons-material/LinkOutlined";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import {
  FilePickerIconButton,
  IMAGE_FILE_ACCEPT,
  firstFileRejectionMessage,
} from "@/components/shared/file-picker";

const InlineAttachmentImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      attachmentId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-attachment-id"),
        renderHTML: (attributes) =>
          attributes.attachmentId
            ? { "data-attachment-id": attributes.attachmentId }
            : {},
      },
      previewUrl: {
        default: null,
        rendered: false,
      },
    };
  },
  addNodeView() {
    return ({ node }) => {
      const image = document.createElement("img");
      image.draggable = false;
      const sync = (current: typeof node) => {
        image.src = current.attrs.previewUrl || current.attrs.src;
        image.alt = current.attrs.alt || "正文图片";
        image.dataset.attachmentId = current.attrs.attachmentId || "";
      };
      sync(node);
      return {
        dom: image,
        update: (nextNode) => {
          if (nextNode.type !== node.type) return false;
          sync(nextNode);
          return true;
        },
      };
    };
  },
});

export type RichTextImageUploadResult = {
  attachmentId: string;
};

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  disabled = false,
  minHeight = 140,
  maxHeight = 360,
  uploadImage,
  onImageUploadingChange,
  resolveImageUrl = (attachmentId) =>
    `/api/v1/attachments/${attachmentId}?disposition=inline`,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  minHeight?: number;
  maxHeight?: number;
  uploadImage?: (file: File) => Promise<RichTextImageUploadResult>;
  onImageUploadingChange?: (uploading: boolean) => void;
  resolveImageUrl?: (attachmentId: string) => string;
}) {
  const uploadImageRef = useRef(uploadImage);
  const resolveImageUrlRef = useRef(resolveImageUrl);
  const objectUrlsRef = useRef(new Set<string>());
  const [uploadingImages, setUploadingImages] = useState(0);
  const [imageError, setImageError] = useState("");

  useEffect(() => {
    uploadImageRef.current = uploadImage;
  }, [uploadImage]);

  useEffect(() => {
    resolveImageUrlRef.current = resolveImageUrl;
  }, [resolveImageUrl]);

  useEffect(() => {
    onImageUploadingChange?.(uploadingImages > 0);
  }, [onImageUploadingChange, uploadingImages]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          rel: "noopener noreferrer",
          target: "_blank",
        },
      }),
      Placeholder.configure({
        placeholder: placeholder ?? "输入内容",
      }),
      InlineAttachmentImage.configure({
        allowBase64: false,
        inline: false,
      }),
    ],
    content: value || "",
    editable: !disabled,
    onUpdate: ({ editor: current }) => {
      onChange(current.getHTML());
    },
    editorProps: {
      attributes: {
        class: "request-rich-editor",
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter(
          (file) => file.type.startsWith("image/"),
        );
        if (files.length === 0 || !uploadImageRef.current) return false;
        event.preventDefault();
        void insertImages(files);
        return true;
      },
    },
  });

  async function insertImages(files: File[]) {
    if (!editor || !uploadImageRef.current || disabled) return;
    setImageError("");
    const selectedFiles = files.slice(0, 20);
    setUploadingImages((count) => count + selectedFiles.length);
    for (const file of selectedFiles) {
      const previewUrl = URL.createObjectURL(file);
      try {
        const result = await uploadImageRef.current(file);
        objectUrlsRef.current.add(previewUrl);
        editor
          .chain()
          .focus()
          .setImage({
            src: `attachment://${result.attachmentId}`,
            alt: file.name || "正文图片",
          })
          .updateAttributes("image", {
            attachmentId: result.attachmentId,
            previewUrl,
          })
          .run();
      } catch (error) {
        URL.revokeObjectURL(previewUrl);
        setImageError(
          error instanceof Error ? error.message : "图片上传失败",
        );
      } finally {
        setUploadingImages((count) => Math.max(0, count - 1));
      }
    }
  }

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [disabled, editor]);

  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if ((value || "") !== current && value !== undefined) {
      editor.commands.setContent(value || "", { emitUpdate: false });
    }
  }, [editor, value]);

  useEffect(() => {
    if (!editor) return;
    const transaction = editor.state.tr;
    let changed = false;
    editor.state.doc.descendants((node, position) => {
      if (node.type.name !== "image" || !node.attrs.attachmentId) return;
      const previewUrl = resolveImageUrlRef.current(node.attrs.attachmentId);
      if (node.attrs.previewUrl === previewUrl) return;
      transaction.setNodeMarkup(
        position,
        undefined,
        { ...node.attrs, previewUrl },
        node.marks,
      );
      changed = true;
    });
    if (changed) editor.view.dispatch(transaction);
  }, [editor, value]);

  useEffect(
    () => () => {
      for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
      objectUrlsRef.current.clear();
    },
  );

  if (!editor) {
    return (
      <Box
        sx={{
          minHeight,
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 1.5,
          p: 2,
        }}
      >
        <Typography color="text.secondary">编辑器加载中…</Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1.5,
        overflow: "hidden",
        bgcolor: "background.paper",
      }}
    >
      <Stack
        direction="row"
        spacing={0.25}
        sx={{
          px: 0.75,
          py: 0.5,
          borderBottom: "1px solid",
          borderColor: "divider",
          bgcolor: "action.hover",
          flexWrap: "wrap",
        }}
      >
        <Tooltip title="加粗">
          <span>
            <IconButton
              size="small"
              disabled={disabled}
              color={editor.isActive("bold") ? "primary" : "default"}
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              <FormatBoldOutlinedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="斜体">
          <span>
            <IconButton
              size="small"
              disabled={disabled}
              color={editor.isActive("italic") ? "primary" : "default"}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              <FormatItalicOutlinedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="无序列表">
          <span>
            <IconButton
              size="small"
              disabled={disabled}
              color={editor.isActive("bulletList") ? "primary" : "default"}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            >
              <FormatListBulletedOutlinedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="有序列表">
          <span>
            <IconButton
              size="small"
              disabled={disabled}
              color={editor.isActive("orderedList") ? "primary" : "default"}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
            >
              <FormatListNumberedOutlinedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Divider flexItem orientation="vertical" sx={{ mx: 0.5 }} />
        <Tooltip title="插入链接">
          <span>
            <IconButton
              size="small"
              disabled={disabled}
              color={editor.isActive("link") ? "primary" : "default"}
              onClick={() => {
                const previous = editor.getAttributes("link").href as
                  | string
                  | undefined;
                const next = window.prompt("输入链接地址", previous ?? "https://");
                if (next === null) return;
                const href = next.trim();
                if (!href) {
                  editor.chain().focus().extendMarkRange("link").unsetLink().run();
                  return;
                }
                editor
                  .chain()
                  .focus()
                  .extendMarkRange("link")
                  .setLink({ href })
                  .run();
              }}
            >
              <LinkOutlinedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        {uploadImage ? (
          <Tooltip title="插入图片">
            <span>
              <FilePickerIconButton
                aria-label="插入图片"
                size="small"
                disabled={disabled || uploadingImages > 0}
                accept={IMAGE_FILE_ACCEPT}
                multiple
                onFiles={(files) => void insertImages(files)}
                onRejected={(rejections) =>
                  setImageError(firstFileRejectionMessage(rejections))
                }
              >
                {uploadingImages > 0 ? (
                  <CircularProgress size={18} />
                ) : (
                  <ImageOutlinedIcon fontSize="small" />
                )}
              </FilePickerIconButton>
            </span>
          </Tooltip>
        ) : null}
      </Stack>
      <Box
        sx={{
          minHeight,
          maxHeight,
          overflowY: "auto",
          px: 1.5,
          py: 1.25,
          "& .ProseMirror": {
            minHeight: minHeight - 16,
            outline: "none",
            fontSize: 15,
            lineHeight: 1.7,
          },
          "& .ProseMirror p": { m: 0, mb: 0.75 },
          "& .ProseMirror p:last-child": { mb: 0 },
          "& .ProseMirror ul, & .ProseMirror ol": {
            my: 0.5,
            pl: 2.5,
          },
          "& .ProseMirror a": {
            color: "primary.main",
          },
          "& .ProseMirror img": {
            display: "block",
            maxWidth: "100%",
            maxHeight: 420,
            my: 1,
            borderRadius: 1.5,
            objectFit: "contain",
          },
          "& .ProseMirror p.is-editor-empty:first-of-type::before": {
            color: "text.secondary",
            content: "attr(data-placeholder)",
            float: "left",
            height: 0,
            pointerEvents: "none",
          },
        }}
      >
        <EditorContent editor={editor} />
      </Box>
      {imageError ? (
        <Typography color="error" variant="caption" sx={{ px: 1.5, pb: 1 }}>
          {imageError}
        </Typography>
      ) : null}
    </Box>
  );
}
