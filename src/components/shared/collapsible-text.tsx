"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Box, Button, Typography } from "@mui/material";

function looksLikeHtml(body: string) {
  return /<\/?[a-z][\s\S]*>/i.test(body);
}

export function CollapsibleText({
  text,
  maxLines = 8,
}: {
  text: string;
  maxLines?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const html = looksLikeHtml(text);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    setOverflowing(node.scrollHeight > node.clientHeight + 2);
  }, [text, maxLines, expanded]);

  return (
    <Box>
      {html ? (
        <Box
          ref={ref}
          sx={{
            mt: 1.25,
            lineHeight: 1.8,
            wordBreak: "break-word",
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: expanded ? "unset" : maxLines,
            overflow: "hidden",
            "& p": { m: 0, mb: 0.75 },
            "& p:last-child": { mb: 0 },
            "& ul, & ol": { my: 0.5, pl: 2.25 },
          }}
          dangerouslySetInnerHTML={{ __html: text }}
        />
      ) : (
        <Typography
          ref={ref}
          sx={{
            mt: 1.25,
            lineHeight: 1.8,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: expanded ? "unset" : maxLines,
            overflow: "hidden",
          }}
        >
          {text}
        </Typography>
      )}
      {overflowing || expanded ? (
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
