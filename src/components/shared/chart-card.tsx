"use client";

import type { ReactNode } from "react";
import { Box, Paper, Skeleton, Typography } from "@mui/material";

export function ChartCard({
  title,
  children,
  loading = false,
  height = 240,
}: {
  title: string;
  children?: ReactNode;
  loading?: boolean;
  height?: number;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Typography variant="h3" sx={{ mb: 2 }}>
        {title}
      </Typography>
      <Box sx={{ height, position: "relative" }}>
        {loading ? (
          <Skeleton
            variant="rectangular"
            width="100%"
            height="100%"
            sx={{ borderRadius: 1.5 }}
          />
        ) : (
          children
        )}
      </Box>
    </Paper>
  );
}
