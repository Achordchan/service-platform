import { Box, Container, Skeleton, Stack } from "@mui/material";

export default function StaffLoading() {
  return (
    <Container maxWidth={false} sx={{ px: { xs: 2, md: 3.5 }, py: { xs: 3, md: 4 } }}>
      <Stack spacing={3}>
        <Box>
          <Skeleton variant="text" width={220} height={52} />
          <Skeleton variant="text" width={340} />
        </Box>
        <Skeleton variant="rounded" height={76} />
        <Skeleton variant="rounded" height={520} />
      </Stack>
    </Container>
  );
}
