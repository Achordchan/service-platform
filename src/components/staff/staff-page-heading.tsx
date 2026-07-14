"use client";

import Link from "next/link";
import { Box, Button, Stack, Typography } from "@mui/material";
import ArrowBackOutlinedIcon from "@mui/icons-material/ArrowBackOutlined";

export function StaffPageHeading({
  title,
  description,
  backHref,
  backLabel,
  action,
  status,
}: {
  title: string;
  description?: string;
  backHref?: string;
  backLabel?: string;
  action?: React.ReactNode;
  status?: React.ReactNode;
}) {
  return (
    <Stack spacing={1.5}>
      {backHref ? (
        <Button
          component={Link}
          href={backHref}
          startIcon={<ArrowBackOutlinedIcon />}
          color="inherit"
          sx={{ alignSelf: "flex-start", px: 0 }}
        >
          {backLabel ?? "返回"}
        </Button>
      ) : null}
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={2}
        sx={{
          alignItems: { xs: "stretch", md: "flex-start" },
          justifyContent: "space-between",
          width: "100%",
        }}
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack
            direction="row"
            spacing={1.5}
            sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}
          >
            <Typography variant="h1">{title}</Typography>
            {status}
          </Stack>
          {description ? (
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              {description}
            </Typography>
          ) : null}
        </Box>
        {action ? (
          <Box
            sx={{
              flex: "0 0 auto",
              display: "flex",
              justifyContent: { xs: "stretch", md: "flex-end" },
              maxWidth: { xs: "100%", md: "48%" },
            }}
          >
            {action}
          </Box>
        ) : null}
      </Stack>
    </Stack>
  );
}
