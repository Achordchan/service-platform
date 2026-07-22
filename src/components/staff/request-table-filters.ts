import type {
  RequestListItem,
  RequestPriority,
  RequestStatus,
} from "@/components/staff/staff-types";
import { matchesRequestArchiveFilter } from "@/lib/request-archive";

export type RequestAdvancedFilterValue = {
  priority: "ALL" | RequestPriority;
  category: string;
  serviceType: string;
  assignee: string;
  source: "ALL" | "ACHORD" | "SUB2API" | "UNIVERSAL";
};

export type RequestTableFilterValue = {
  status: "ALL" | "ARCHIVED" | RequestStatus;
  projectId: string;
  customerKey: string;
  advanced: RequestAdvancedFilterValue;
  keyword: string;
};

export const defaultAdvancedFilters: RequestAdvancedFilterValue = {
  priority: "ALL",
  category: "ALL",
  serviceType: "ALL",
  assignee: "ALL",
  source: "ALL",
};

export function buildRequestFilterOptions(requests: RequestListItem[]) {
  const projectOptions = Array.from(
    new Map(
      requests.map((request) => [
        request.projectId,
        { id: request.projectId, title: request.projectTitle },
      ]),
    ).values(),
  );
  const customerOptions = Array.from(
    new Map(
      requests.map((request) => [
        request.customerFilterKey ?? request.customerName,
        {
          key: request.customerFilterKey ?? request.customerName,
          name: request.customerName,
        },
      ]),
    ).values(),
  ).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  const categories = Array.from(
    new Set(requests.map((request) => request.categoryName)),
  ).sort((a, b) => a.localeCompare(b, "zh-CN"));
  const serviceTypes = Array.from(
    new Set(requests.map((request) => request.serviceTypeName)),
  ).sort((a, b) => a.localeCompare(b, "zh-CN"));
  const assignees = Array.from(
    new Map(
      requests.flatMap((request) =>
        (request.assignedStaff ?? []).map((member) => [
          member.id,
          { value: member.id, label: member.name },
        ]),
      ),
    ).values(),
  ).sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));

  return { projectOptions, customerOptions, categories, serviceTypes, assignees };
}

export function filterRequestRows(
  requests: RequestListItem[],
  filters: RequestTableFilterValue,
) {
  const normalized = filters.keyword.trim().toLowerCase();
  return requests.filter((request) => {
    const assignedStaff = request.assignedStaff ?? [];
    return (
      matchesRequestArchiveFilter(request, filters.status) &&
      (filters.projectId === "ALL" || request.projectId === filters.projectId) &&
      (filters.customerKey === "ALL" ||
        (request.customerFilterKey ?? request.customerName) ===
          filters.customerKey) &&
      (filters.advanced.priority === "ALL" ||
        request.priority === filters.advanced.priority) &&
      (filters.advanced.category === "ALL" ||
        request.categoryName === filters.advanced.category) &&
      (filters.advanced.serviceType === "ALL" ||
        request.serviceTypeName === filters.advanced.serviceType) &&
      (filters.advanced.source === "ALL" ||
        (request.source ?? "ACHORD") === filters.advanced.source) &&
      (filters.advanced.assignee === "ALL" ||
        (filters.advanced.assignee === "UNASSIGNED"
          ? assignedStaff.length === 0
          : assignedStaff.some(
              (member) => member.id === filters.advanced.assignee,
            ))) &&
      (!normalized ||
        request.number.toLowerCase().includes(normalized) ||
        request.title.toLowerCase().includes(normalized) ||
        request.customerName.toLowerCase().includes(normalized) ||
        request.projectTitle.toLowerCase().includes(normalized) ||
        request.serviceTypeName.toLowerCase().includes(normalized) ||
        request.categoryName.toLowerCase().includes(normalized))
    );
  });
}
