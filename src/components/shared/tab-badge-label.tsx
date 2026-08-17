"use client";

import { Box } from "@mui/material";

export function UnreadCountPill({ count }: { count: number }) {
  if (count <= 0) return null;

  return (
    <Box
      component="span"
      aria-label={`${count} 条未读`}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        minWidth: 16,
        height: 16,
        px: 0.5,
        borderRadius: 8,
        bgcolor: "error.main",
        color: "error.contrastText",
        fontSize: 10,
        fontWeight: 650,
        lineHeight: 1,
      }}
    >
      {count > 99 ? "99+" : count}
    </Box>
  );
}

export function UnreadDot({ count }: { count: number }) {
  if (count <= 0) return null;

  return (
    <Box
      component="span"
      aria-label={`${count} 条未读更新`}
      sx={{
        display: "inline-block",
        flexShrink: 0,
        width: 8,
        height: 8,
        borderRadius: "50%",
        bgcolor: "error.main",
      }}
    />
  );
}

export function TabBadgeLabel({
  label,
  count,
}: {
  label: string;
  count?: number;
}) {
  const value = count && count > 0 ? count : 0;
  return (
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.75,
        minWidth: 0,
        whiteSpace: "nowrap",
      }}
    >
      <Box component="span">{label}</Box>
      <UnreadCountPill count={value} />
    </Box>
  );
}
