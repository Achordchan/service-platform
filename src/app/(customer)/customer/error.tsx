"use client";

import { Container, Stack, Typography } from "@mui/material";
import { ErrorState } from "@/components/shared/content-state";

export default function CustomerError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Container
      maxWidth={false}
      sx={{ px: { xs: 2, md: 5 }, py: { xs: 3, md: 5 } }}
    >
      <Stack spacing={1}>
        <ErrorState
          message="客户服务数据暂时无法加载，请检查网络后重试。"
          onRetry={reset}
        />
        {error.digest ? (
          <Typography variant="body2" color="text.secondary">
            错误编号：{error.digest}
          </Typography>
        ) : null}
      </Stack>
    </Container>
  );
}
