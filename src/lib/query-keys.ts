export const queryKeys = {
  attachmentPolicy: ["attachment-policy"] as const,
  auditLogs: {
    list: (query: string) => ["audit-logs", "list", query] as const,
  },
  contentRisk: {
    plugin: ["content-risk", "plugin"] as const,
    dashboard: ["content-risk", "dashboard"] as const,
  },
  customerSpaces: {
    detail: (customerSpaceId: string) =>
      ["customer-spaces", "detail", customerSpaceId] as const,
  },
  dashboard: {
    analytics: ["dashboard", "analytics"] as const,
  },
  notifications: {
    list: ["notifications", "list"] as const,
    summary: ["notifications", "summary"] as const,
  },
  plugins: {
    dingtalk: ["plugins", "dingtalk-robot"] as const,
  },
  sub2api: {
    externalContactsRoot: (projectId: string) =>
      ["sub2api", "external-contacts", projectId] as const,
    integration: (projectId: string) =>
      ["sub2api", "integration", projectId] as const,
    externalContacts: (
      projectId: string,
      keyword: string,
      status: string,
    ) => ["sub2api", "external-contacts", projectId, keyword, status] as const,
  },
  universal: {
    integration: (projectId: string) =>
      ["universal", "integration", projectId] as const,
    deliveries: (projectId: string) =>
      ["universal", "webhook-deliveries", projectId] as const,
  },
  supportPlaybooks: {
    admin: ["support-playbooks", "admin"] as const,
    available: ["support-playbooks", "available"] as const,
  },
};
