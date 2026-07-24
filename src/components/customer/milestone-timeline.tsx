import type { ProjectMilestone } from "@/components/customer/customer-types";
import { MilestoneList } from "@/components/shared/milestone-list";

export function MilestoneTimeline({
  milestones,
  contentRiskEnabled = false,
}: {
  milestones: ProjectMilestone[];
  contentRiskEnabled?: boolean;
}) {
  return (
    <MilestoneList
      milestones={milestones}
      contentRiskEnabled={contentRiskEnabled}
    />
  );
}
