"use client";

import { Alert, Button, Container, Stack } from "@mui/material";

export default function StaffError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Container maxWidth={false} sx={{ px: { xs: 2, md: 3.5 }, py: { xs: 3, md: 4 } }}>
      <Stack spacing={2}>
        <Alert severity="error">页面加载失败，请重新尝试。</Alert>
        <Button variant="contained" onClick={reset} sx={{ alignSelf: "flex-start" }}>
          重新加载
        </Button>
      </Stack>
    </Container>
  );
}
