"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Box, Paper, Typography } from "@mui/material";

type StatTone = "neutral" | "primary" | "warning" | "success";

export function StatCard({
  label,
  value,
  icon,
  tone = "neutral",
  href,
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  tone?: StatTone;
  href?: string;
}) {
  return (
    <Paper
      variant="outlined"
      {...(href ? { component: Link, href } : {})}
      sx={{
        p: 2,
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        flex: "1 1 200px",
        minWidth: 0,
        textDecoration: "none",
        color: "inherit",
        transition: "border-color 120ms ease, box-shadow 120ms ease",
        ...(href && {
          cursor: "pointer",
          "&:hover": {
            borderColor: "primary.main",
            boxShadow: 1,
          },
        }),
      }}
    >
      <Box
        sx={(theme) => ({
          display: "grid",
          placeItems: "center",
          width: 40,
          height: 40,
          flex: "0 0 auto",
          borderRadius: 2,
          color:
            tone === "neutral"
              ? theme.palette.text.secondary
              : theme.palette[tone].main,
          bgcolor:
            tone === "neutral"
              ? theme.palette.action.hover
              : theme.palette[tone].main,
          ...(tone !== "neutral" && {
            bgcolor: `color-mix(in srgb, ${theme.palette[tone].main} 14%, transparent)`,
          }),
          "& svg": { fontSize: 20 },
        })}
      >
        {icon}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="h2">{value}</Typography>
        <Typography variant="body2" color="text.secondary" noWrap>
          {label}
        </Typography>
      </Box>
    </Paper>
  );
}
