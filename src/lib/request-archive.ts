export type RequestArchiveFilter = "ALL" | "ARCHIVED" | string;

export function canArchiveRequestStatus(status: string) {
  return status === "RESOLVED" || status === "CLOSED";
}

export function matchesRequestArchiveFilter(
  request: { status: string; archivedAt?: string | Date | null },
  filter: RequestArchiveFilter,
) {
  if (filter === "ARCHIVED") return Boolean(request.archivedAt);
  if (request.archivedAt) return false;
  return filter === "ALL" || request.status === filter;
}
