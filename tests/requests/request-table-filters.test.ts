import { describe, expect, it } from "vitest";
import type { RequestListItem } from "@/components/staff/staff-types";
import {
  buildRequestFilterOptions,
  defaultAdvancedFilters,
  filterRequestRows,
} from "@/components/staff/request-table-filters";

const requests: RequestListItem[] = [
  createRequest({
    id: "request-a",
    customerFilterKey: "customer-a",
    customerName: "甲客户",
    projectId: "project-a",
    projectTitle: "官网项目",
    priority: "HIGH",
    categoryName: "故障",
    serviceTypeName: "网站运维",
    assignedStaff: [{ id: "staff-a", name: "张技术" }],
  }),
  createRequest({
    id: "request-b",
    customerFilterKey: "SUB2API_EXTERNAL",
    customerName: "Sub2API 外部用户",
    projectId: "project-b",
    projectTitle: "ChordV-API",
    source: "SUB2API",
    assignedStaff: [],
  }),
  createRequest({
    id: "request-c",
    customerFilterKey: "SUB2API_EXTERNAL",
    customerName: "Sub2API 外部用户",
    projectId: "project-c",
    projectTitle: "另一外部项目",
    source: "SUB2API",
    assignedStaff: [{ id: "staff-b", name: "李技术" }],
  }),
];

describe("服务请求筛选", () => {
  it("按客户筛选，并把多个 Sub2API 项目聚合为一个客户选项", () => {
    const options = buildRequestFilterOptions(requests);
    expect(options.customerOptions).toHaveLength(2);
    expect(
      filterRequestRows(requests, {
        status: "ALL",
        projectId: "ALL",
        customerKey: "SUB2API_EXTERNAL",
        advanced: defaultAdvancedFilters,
        keyword: "",
      }).map((request) => request.id),
    ).toEqual(["request-b", "request-c"]);
  });

  it("支持优先级、分类、服务类型和来源组合筛选", () => {
    expect(
      filterRequestRows(requests, {
        status: "ALL",
        projectId: "ALL",
        customerKey: "ALL",
        advanced: {
          ...defaultAdvancedFilters,
          priority: "HIGH",
          category: "故障",
          serviceType: "网站运维",
          source: "ACHORD",
        },
        keyword: "官网",
      }).map((request) => request.id),
    ).toEqual(["request-a"]);
  });

  it("多人处理人和待分配筛选使用人员 ID，不依赖显示名称", () => {
    const byAssignee = filterRequestRows(requests, {
      status: "ALL",
      projectId: "ALL",
      customerKey: "ALL",
      advanced: { ...defaultAdvancedFilters, assignee: "staff-b" },
      keyword: "",
    });
    const unassigned = filterRequestRows(requests, {
      status: "ALL",
      projectId: "ALL",
      customerKey: "ALL",
      advanced: { ...defaultAdvancedFilters, assignee: "UNASSIGNED" },
      keyword: "",
    });
    expect(byAssignee.map((request) => request.id)).toEqual(["request-c"]);
    expect(unassigned.map((request) => request.id)).toEqual(["request-b"]);
  });
});

function createRequest(
  overrides: Partial<RequestListItem> & Pick<RequestListItem, "id">,
): RequestListItem {
  const { id, ...rest } = overrides;
  return {
    id,
    number: `SR-${id}`,
    title: "测试请求",
    description: "",
    priority: "NORMAL",
    status: "PENDING",
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
    projectId: "project-default",
    projectTitle: "默认项目",
    customerFilterKey: "customer-default",
    customerName: "默认客户",
    serviceTypeName: "默认服务",
    categoryName: "咨询",
    assigneeId: null,
    assigneeName: null,
    assignedStaff: [],
    createdByName: "测试用户",
    source: "ACHORD",
    ...rest,
  };
}
