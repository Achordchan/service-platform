import { Container } from "@mui/material";
import { LoadingState } from "@/components/shared/content-state";

export default function CustomerLoading() {
  return (
    <Container
      maxWidth={false}
      sx={{ px: { xs: 2, md: 5 }, py: { xs: 3, md: 5 } }}
    >
      <LoadingState label="正在加载客户服务数据" />
    </Container>
  );
}
