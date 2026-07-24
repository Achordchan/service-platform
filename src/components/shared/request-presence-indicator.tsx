"use client";

import { Box, Stack, Typography } from "@mui/material";

export function RequestPresenceIndicator({
  online,
  label,
}: {
  online: boolean;
  label: string;
}) {
  if (!online) return null;

  return (
    <Stack
      direction="row"
      spacing={0.75}
      role="status"
      aria-live="polite"
      sx={{ alignItems: "center", color: "success.main", whiteSpace: "nowrap" }}
    >
      <Box
        sx={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          bgcolor: "success.main",
        }}
      />
      <Typography variant="body2" component="span" sx={{ color: "inherit" }}>
        {label}
      </Typography>
    </Stack>
  );
}
