import type { MilestoneStatus } from "@/generated/prisma/client";

export type MilestoneProgressInput = {
  status: MilestoneStatus;
};

export function calculateProjectProgress(
  milestones: MilestoneProgressInput[],
) {
  const counts = {
    total: milestones.length,
    notStarted: 0,
    inProgress: 0,
    completed: 0,
  };

  for (const milestone of milestones) {
    if (milestone.status === "NOT_STARTED") counts.notStarted += 1;
    if (milestone.status === "IN_PROGRESS") counts.inProgress += 1;
    if (milestone.status === "COMPLETED") counts.completed += 1;
  }

  return {
    percentage:
      milestones.length === 0
        ? 0
        : Math.round((counts.completed / milestones.length) * 100),
    counts,
  };
}
