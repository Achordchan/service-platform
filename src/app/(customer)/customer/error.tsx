"use client";

import { Container } from "@mui/material";
import { ErrorState } from "@/components/shared/content-state";

export default function CustomerError({
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
      <ErrorState
        message="客户服务数据暂时无法加载，请检查网络后重试。"
        onRetry={reset}
      />
    </Container>
  );
}
