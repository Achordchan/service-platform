import { NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteRoleGroup,
  updateRoleGroup,
} from "@/modules/users/role-group-service";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

const updateSchema = z
  .object({
    name: z.string().trim().min(2).max(60).optional(),
    key: z
      .string()
      .trim()
      .min(2)
      .max(60)
      .regex(/^[a-z0-9_]+$/)
      .optional(),
    description: z.string().trim().max(300).optional().or(z.literal("")),
    accessLevel: z.enum(["PROJECT_MANAGER", "TECHNICIAN"]).optional(),
    permissions: z.array(z.string()).optional(),
    active: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "至少更新一个字段",
  });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ roleGroupId: string }> },
) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { roleGroupId } = await context.params;
    const input = updateSchema.parse(await readJson(request));
    const group = await updateRoleGroup(auth.actor, roleGroupId, input);
    return NextResponse.json({ data: group });
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ roleGroupId: string }> },
) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { roleGroupId } = await context.params;
    await deleteRoleGroup(auth.actor, roleGroupId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return routeError(error);
  }
}
