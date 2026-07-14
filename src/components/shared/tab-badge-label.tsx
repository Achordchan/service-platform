"use client";

import { Badge, Box } from "@mui/material";

export function TabBadgeLabel({
  label,
  count,
}: {
  label: string;
  count?: number;
}) {
  const value = count && count > 0 ? count : 0;
  return (
    <Badge
      color="error"
      badgeContent={value > 99 ? "99+" : value}
      invisible={value <= 0}
      sx={{
        "& .MuiBadge-badge": {
          right: -10,
          top: 2,
          minWidth: 16,
          height: 16,
          fontSize: 10,
          fontWeight: 700,
          px: 0.5,
        },
      }}
    >
      <Box component="span" sx={{ display: "inline-block", pr: value > 0 ? 0.75 : 0 }}>
        {label}
      </Box>
    </Badge>
  );
}
