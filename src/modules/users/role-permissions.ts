export const ROLE_PERMISSION_OPTIONS = [
  {
    key: "project.view",
    label: "查看授权项目",
    description: "查看被分配项目的公共信息与进度",
  },
  {
    key: "project.manage_delivery",
    label: "管理项目交付",
    description: "维护里程碑、进度阶段和交付状态",
  },
  {
    key: "project.manage_staff",
    label: "管理项目人员",
    description: "在授权项目中分配/移除内部人员",
  },
  {
    key: "update.publish",
    label: "发布进度动态",
    description: "向客户或内部发布项目进度",
  },
  {
    key: "update.comment",
    label: "评论进度动态",
    description: "在进度动态下留言",
  },
  {
    key: "request.view_project",
    label: "查看项目全部请求",
    description: "查看授权项目内全部服务请求",
  },
  {
    key: "request.view_assigned",
    label: "查看分配给自己的请求",
    description: "仅查看自己被分配的服务请求",
  },
  {
    key: "request.assign",
    label: "分配服务请求",
    description: "将请求指派给技术人员",
  },
  {
    key: "request.reply",
    label: "回复服务请求",
    description: "在服务请求中发送消息",
  },
  {
    key: "request.change_status",
    label: "变更请求状态",
    description: "更新处理中/待客户/已解决等状态",
  },
  {
    key: "file.upload",
    label: "上传文件资料",
    description: "在项目或请求中上传附件",
  },
] as const;

export type RolePermissionKey =
  (typeof ROLE_PERMISSION_OPTIONS)[number]["key"];

export const DEFAULT_PERMISSIONS_BY_LEVEL: Record<
  "PROJECT_MANAGER" | "TECHNICIAN",
  RolePermissionKey[]
> = {
  PROJECT_MANAGER: [
    "project.view",
    "project.manage_delivery",
    "project.manage_staff",
    "request.view_project",
    "request.assign",
    "request.reply",
    "request.change_status",
    "file.upload",
    "update.publish",
  ],
  TECHNICIAN: [
    "project.view",
    "request.view_assigned",
    "request.reply",
    "request.change_status",
    "file.upload",
  ],
};

export function sanitizePermissions(
  permissions: string[],
  accessLevel: "PROJECT_MANAGER" | "TECHNICIAN",
) {
  const allowed = new Set(ROLE_PERMISSION_OPTIONS.map((item) => item.key));
  const unique = Array.from(
    new Set(permissions.filter((item) => allowed.has(item as RolePermissionKey))),
  ) as RolePermissionKey[];

  if (unique.length === 0) {
    return [...DEFAULT_PERMISSIONS_BY_LEVEL[accessLevel]];
  }

  // Technician-level groups cannot get manager-only broad controls.
  if (accessLevel === "TECHNICIAN") {
    return unique.filter(
      (item) =>
        item !== "project.manage_delivery" &&
        item !== "project.manage_staff" &&
        item !== "request.assign" &&
        item !== "request.view_project" &&
        item !== "update.publish",
    );
  }

  return unique;
}
