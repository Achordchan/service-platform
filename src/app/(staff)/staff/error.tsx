"use client";

import { Alert, Button, Stack, Typography } from "@mui/material";
import { PageContainer } from "@/components/shared/page-container";

export default function StaffError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <PageContainer>
      <Stack spacing={2}>
        <Alert severity="error">页面加载失败，请重新尝试。</Alert>
        {error.digest ? (
          <Typography variant="body2" color="text.secondary">
            错误编号：{error.digest}
          </Typography>
        ) : null}
        <Button variant="contained" onClick={reset} sx={{ alignSelf: "flex-start" }}>
          重新加载
        </Button>
      </Stack>
    </PageContainer>
  );
}
