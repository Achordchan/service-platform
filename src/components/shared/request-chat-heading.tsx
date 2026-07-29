"use client";

import { Box, Stack, Typography } from "@mui/material";

export function RequestChatHeading({
  counterpartOnline,
  counterpartLabel,
}: {
  counterpartOnline: boolean;
  counterpartLabel: string;
}) {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{
        mb: 1.5,
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <Typography variant="h3">沟通记录</Typography>
      {counterpartOnline ? (
        <Stack
          direction="row"
          spacing={0.75}
          role="status"
          aria-live="polite"
          sx={{
            alignItems: "center",
            color: "success.main",
            fontWeight: 650,
            whiteSpace: "nowrap",
          }}
        >
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              bgcolor: "success.main",
              boxShadow: "0 0 0 3px rgba(34,197,94,0.14)",
            }}
          />
          <Typography variant="body2" component="span" sx={{ fontWeight: 650 }}>
            {counterpartLabel}在线
          </Typography>
        </Stack>
      ) : null}
    </Stack>
  );
}
