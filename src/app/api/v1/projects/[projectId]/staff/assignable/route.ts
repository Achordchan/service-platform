import { NextResponse } from "next/server";
import { listAssignableProjectStaff } from "@/modules/users/user-service";
import { requireApiActor, routeError } from "@/modules/projects/api-utils";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

// 可加入该项目的内部人员候选（管理员/项目经理/技术）。
// 权限由 listAssignableProjectStaff → assertCanManageProjectStaff 裁决；
// 小程序项目人员管理页据此渲染候选选择器（Web 端由服务组件直接查库，无此路由）。
export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { projectId } = await context.params;
    const users = await listAssignableProjectStaff(auth.actor, projectId);
    return NextResponse.json({ data: users });
  } catch (error) {
    return routeError(error);
  }
}
