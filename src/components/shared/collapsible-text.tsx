"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import { resolveInlineAttachmentHtml } from "@/lib/message-content";

function looksLikeHtml(body: string) {
  return /<\/?[a-z][\s\S]*>/i.test(body);
}

export function CollapsibleText({
  text,
  maxLines = 8,
  resolveInlineImageUrl,
  collapsible = true,
}: {
  text: string;
  maxLines?: number;
  resolveInlineImageUrl?: (attachmentId: string) => string;
  collapsible?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const html = looksLikeHtml(text);
  const renderedHtml = html
    ? resolveInlineAttachmentHtml(text, resolveInlineImageUrl)
    : text;

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    setOverflowing(
      collapsible && node.scrollHeight > node.clientHeight + 2,
    );
  }, [text, maxLines, expanded, collapsible]);

  return (
    <Box>
      {html ? (
        <Box
          ref={ref}
          sx={{
            mt: 1.25,
            lineHeight: 1.8,
            wordBreak: "break-word",
            display: collapsible ? "-webkit-box" : "block",
            WebkitBoxOrient: collapsible ? "vertical" : undefined,
            WebkitLineClamp:
              collapsible && !expanded ? maxLines : "unset",
            overflow: collapsible ? "hidden" : "visible",
            "& p": { m: 0, mb: 0.75 },
            "& p:last-child": { mb: 0 },
            "& ul, & ol": { my: 0.5, pl: 2.25 },
            "& img": {
              display: "block",
              maxWidth: "100%",
              maxHeight: 520,
              my: 1.25,
              borderRadius: 1.5,
              objectFit: "contain",
            },
          }}
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
      ) : (
        <Typography
          ref={ref}
          sx={{
            mt: 1.25,
            lineHeight: 1.8,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            display: collapsible ? "-webkit-box" : "block",
            WebkitBoxOrient: collapsible ? "vertical" : undefined,
            WebkitLineClamp:
              collapsible && !expanded ? maxLines : "unset",
            overflow: collapsible ? "hidden" : "visible",
          }}
        >
          {text}
        </Typography>
      )}
      {collapsible && (overflowing || expanded) ? (
        <Button
          size="small"
          onClick={() => setExpanded((value) => !value)}
          sx={{ mt: 0.75, px: 0.5 }}
        >
          {expanded ? "收起" : "展开全部"}
        </Button>
      ) : null}
    </Box>
  );
}
