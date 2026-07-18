import { Container, Stack } from "@mui/material";
import { ProjectTable } from "@/components/staff/project-table";
import { RealtimeRouteRefresh } from "@/components/shared/realtime-route-refresh";
import { StaffPageHeading } from "@/components/staff/staff-page-heading";
import type { ProjectListItem } from "@/components/staff/staff-types";
import { requireUserWithAccess } from "@/lib/session";
import { listCustomerSpaces } from "@/modules/customer-spaces/customer-space-service";
import { listProjects } from "@/modules/projects/project-service";
import { listServiceTypes } from "@/modules/projects/service-type-service";
import { listUsers } from "@/modules/users/user-service";
import { listPluginViews } from "@/modules/plugins/plugin-service";
import { getRegisteredPlugin } from "@/modules/plugins/plugin-registry";

export const metadata = {
  title: "项目",
};

export default async function StaffProjectsPage() {
  const { actor } = await requireUserWithAccess();
  const projects = await listProjects(actor);
  const adminOptions = actor.isPlatformAdmin
    ? await Promise.all([
        listCustomerSpaces(actor),
        listServiceTypes(actor),
        listUsers(actor, { role: "PROJECT_MANAGER", limit: 200 }),
        listUsers(actor, { role: "PLATFORM_ADMIN", limit: 200 }),
        listPluginViews(actor),
      ])
    : null;

  const managerCandidates =
    adminOptions
      ? [...adminOptions[2], ...adminOptions[3]].map((user) => ({
          id: user.id,
          name: user.name,
          email: user.email,
          platformRole: user.platformRole as
            | "PLATFORM_ADMIN"
            | "PROJECT_MANAGER"
            | "TECHNICIAN",
        }))
      : [];
  const externalConnectors =
    adminOptions?.[4]
      .filter(
        (plugin) =>
          plugin.kind === "EXTERNAL_CONNECTOR" &&
          plugin.enabled &&
          plugin.healthStatus === "READY",
      )
      .map((plugin) => ({ id: plugin.key, name: plugin.name })) ?? [];

  const rows: ProjectListItem[] = projects.map((project) => ({
    id: project.id,
    title: project.title,
    description: project.description,
    status: project.status,
    kind: project.kind,
    currentStage: project.currentStage,
    showMilestones: project.showMilestones,
    showProgress: project.showProgress,
    startDate: project.startDate?.toISOString() ?? null,
    endDate: project.endDate?.toISOString() ?? null,
    updatedAt: project.updatedAt.toISOString(),
    progress: project.progress,
    customerSpace: project.customerSpace,
    serviceType: {
      id: project.serviceType.id,
      name: project.serviceType.name,
    },
    managerNames: project.staff.map((member) => member.user.name),
    requestCount: project._count.requests,
    externalConnectorKey: project.pluginBindings[0]?.pluginKey ?? null,
    externalConnectorLabel: project.pluginBindings[0]
      ? getRegisteredPlugin(project.pluginBindings[0].pluginKey).manifest.name
      : null,
  }));

  return (
    <Container
      maxWidth={false}
      sx={{ px: { xs: 2, md: 3.5 }, py: { xs: 3, md: 4 } }}
    >
      <Stack spacing={3}>
        <RealtimeRouteRefresh mode="project-list" />
        <StaffPageHeading title="项目" />
        <ProjectTable
          projects={rows}
          canCreate={actor.isPlatformAdmin}
          customerSpaces={
            adminOptions?.[0].map((space) => ({
              id: space.id,
              name: space.name,
            })) ?? []
          }
          serviceTypes={
            adminOptions?.[1]
              .filter((serviceType) => serviceType.active)
              .map((serviceType) => ({
                id: serviceType.id,
                name: serviceType.name,
              })) ?? []
          }
          managerCandidates={managerCandidates}
          currentUserId={actor.id}
          externalConnectors={externalConnectors}
        />
      </Stack>
    </Container>
  );
}
