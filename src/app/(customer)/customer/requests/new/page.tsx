import { Stack } from "@mui/material";
import { PageContainer } from "@/components/shared/page-container";
import type { RequestProjectOption } from "@/components/customer/customer-types";
import { NewRequestForm } from "@/components/customer/new-request-form";
import { PageHeading } from "@/components/customer/page-heading";
import { requireUserWithAccess } from "@/lib/session";
import { listProjects } from "@/modules/projects/project-service";

export const metadata = {
  title: "新建服务请求",
};

export default async function NewCustomerRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string | string[] }>;
}) {
  const { actor } = await requireUserWithAccess();
  const query = await searchParams;
  const initialProjectId = Array.isArray(query.projectId)
    ? query.projectId[0]
    : query.projectId;
  const projects = (await listProjects(actor)).filter(
    (project) =>
      project.status === "ACTIVE" &&
      project.customerRequestsEnabled !== false,
  );
  const projectOptions: RequestProjectOption[] = projects.map(
    (project) => ({
      id: project.id,
      title: project.title,
      serviceTypeName: project.serviceType.name,
      categories: project.serviceType.requestCategories,
    }),
  );

  return (
    <PageContainer maxWidth="md">
      <Stack spacing={3}>
        <PageHeading
          backLabel={initialProjectId ? "返回项目请求" : "服务项目"}
          backHref={
            initialProjectId
              ? `/customer/projects/${initialProjectId}?tab=requests`
              : "/customer/projects"
          }
          title="新建服务请求"
        />
        <NewRequestForm
          projects={projectOptions}
          initialProjectId={initialProjectId}
        />
      </Stack>
    </PageContainer>
  );
}
