import { Container } from "@mui/material";
import { EmptyState } from "@/components/shared/content-state";

export default function CustomerNotFound() {
  return (
    <Container
      maxWidth={false}
      sx={{ px: { xs: 2, md: 5 }, py: { xs: 3, md: 5 } }}
    >
      <EmptyState
        title="页面不存在或无权访问"
        description="请返回服务项目重新选择。"
        actionLabel="返回服务项目"
        actionHref="/customer/projects"
      />
    </Container>
  );
}
