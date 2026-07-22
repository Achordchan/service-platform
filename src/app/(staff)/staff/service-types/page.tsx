import { redirect } from "next/navigation";
import { Container, Stack } from "@mui/material";
import { ServiceConfigurationWorkspace } from "@/components/staff/service-configuration-workspace";
import { StaffPageHeading } from "@/components/staff/staff-page-heading";
import type { ServiceTypeItem } from "@/components/staff/staff-types";
import { requireUserWithAccess } from "@/lib/session";
import { listServiceTypes } from "@/modules/projects/service-type-service";
import { listSupportPlaybooksForAdmin } from "@/modules/requests/support-playbook-service";

export const metadata = {
  title: "服务配置",
};

export default async function StaffServiceTypesPage() {
  const { actor } = await requireUserWithAccess();
  if (!actor.isPlatformAdmin) {
    redirect("/staff/projects");
  }
  const [result, playbooks] = await Promise.all([
    listServiceTypes(actor),
    listSupportPlaybooksForAdmin(actor),
  ]);
  const serviceTypes: ServiceTypeItem[] = result.map((serviceType) => ({
    id: serviceType.id,
    key: serviceType.key,
    name: serviceType.name,
    description: serviceType.description,
    active: serviceType.active,
    updatedAt: serviceType.updatedAt.toISOString(),
    categories: serviceType.requestCategories.map((category) => ({
      id: category.id,
      name: category.name,
      description: category.description,
      active: category.active,
    })),
  }));

  return (
    <Container
      maxWidth={false}
      sx={{ px: { xs: 2, md: 3.5 }, py: { xs: 3, md: 4 } }}
    >
      <Stack spacing={3}>
        <StaffPageHeading title="服务配置" />
        <ServiceConfigurationWorkspace
          serviceTypes={serviceTypes}
          playbooks={playbooks}
        />
      </Stack>
    </Container>
  );
}
