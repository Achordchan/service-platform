import { EmptyState } from "@/components/shared/content-state";
import { PageContainer } from "@/components/shared/page-container";

export default function CustomerNotFound() {
  return (
    <PageContainer>
      <EmptyState
        title="页面不存在或无权访问"
        description="请返回服务项目重新选择。"
        actionLabel="返回服务项目"
        actionHref="/customer/projects"
      />
    </PageContainer>
  );
}
