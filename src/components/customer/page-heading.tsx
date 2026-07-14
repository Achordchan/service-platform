"use client";

import Link from "next/link";
import { Box, Button, Stack, Typography } from "@mui/material";
import ArrowBackOutlinedIcon from "@mui/icons-material/ArrowBackOutlined";

export function PageHeading({
  title,
  description,
  actionLabel,
  actionHref,
  backLabel,
  backHref,
  status,
}: {
  title: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
  backLabel?: string;
  backHref?: string;
  status?: React.ReactNode;
}) {
  return (
    <Box>
      {backLabel && backHref ? (
        <Button
          component={Link}
          href={backHref}
          startIcon={<ArrowBackOutlinedIcon />}
          color="inherit"
          sx={{ alignSelf: "flex-start", px: 0, mb: 1.5 }}
        >
          {backLabel}
        </Button>
      ) : null}
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{
          alignItems: { xs: "stretch", sm: "flex-start" },
          justifyContent: "space-between",
        }}
      >
        <Box>
          <Stack
            direction="row"
            spacing={2}
            sx={{ alignItems: "center", flexWrap: "wrap" }}
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
        {actionLabel && actionHref ? (
          <Button
            component={Link}
            href={actionHref}
            variant="contained"
            sx={{ alignSelf: { xs: "stretch", sm: "center" } }}
          >
            {actionLabel}
          </Button>
        ) : null}
      </Stack>
    </Box>
  );
}
