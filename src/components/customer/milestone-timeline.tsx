import type { ProjectMilestone } from "@/components/customer/customer-types";
import { MilestoneList } from "@/components/shared/milestone-list";

export function MilestoneTimeline({
  milestones,
}: {
  milestones: ProjectMilestone[];
}) {
  return <MilestoneList milestones={milestones} />;
}
