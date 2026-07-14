"use client";

import { useEffect } from "react";
import {
  Box,
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
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { unlockUiSound } from "@/lib/ui-sound";

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  disabled = false,
  minHeight = 140,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  minHeight?: number;
}) {
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
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [disabled, editor]);

  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if ((value || "") !== current && value !== undefined) {
      // Avoid caret jump when parent clears after submit.
      if (!value || value === "<p></p>") {
        editor.commands.clearContent(true);
      }
    }
  }, [editor, value]);

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
      onFocusCapture={() => unlockUiSound()}
    >
      <Stack
        direction="row"
        spacing={0.25}
        sx={{
          px: 0.75,
          py: 0.5,
          borderBottom: "1px solid",
          borderColor: "divider",
          bgcolor: "#fafbfc",
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
      </Stack>
      <Box
        sx={{
          minHeight,
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
    </Box>
  );
}
