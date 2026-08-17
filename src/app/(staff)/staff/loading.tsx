import { Box, Skeleton, Stack } from "@mui/material";
import { PageContainer } from "@/components/shared/page-container";

export default function StaffLoading() {
  return (
    <PageContainer>
      <Stack spacing={3}>
        <Box>
          <Skeleton variant="text" width={220} height={52} />
          <Skeleton variant="text" width={340} />
        </Box>
        <Skeleton variant="rounded" height={76} />
        <Skeleton variant="rounded" height={520} />
      </Stack>
    </PageContainer>
  );
}
