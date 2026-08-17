"use client";

import { Stack, Typography } from "@mui/material";
import { ErrorState } from "@/components/shared/content-state";
import { PageContainer } from "@/components/shared/page-container";

export default function CustomerError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <PageContainer>
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
    </PageContainer>
  );
}
