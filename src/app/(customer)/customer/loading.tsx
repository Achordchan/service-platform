import { Box, Skeleton, Stack } from "@mui/material";
import { PageContainer } from "@/components/shared/page-container";

export default function CustomerLoading() {
  return (
    <PageContainer>
      <Stack spacing={3}>
        <Box>
          <Skeleton variant="text" width={180} height={44} />
          <Skeleton variant="text" width={300} />
        </Box>
        <Skeleton variant="rounded" height={76} />
        <Skeleton variant="rounded" height={420} />
      </Stack>
    </PageContainer>
  );
}
