import { NextResponse } from "next/server";
import {
  createRoleGroup,
  listRoleGroups,
} from "@/modules/users/role-group-service";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().trim().min(2).max(60),
  key: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9_]+$/)
    .optional(),
  description: z.string().trim().max(300).optional().or(z.literal("")),
  accessLevel: z.enum(["PROJECT_MANAGER", "TECHNICIAN"]),
  permissions: z.array(z.string()).default([]),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export async function GET(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const activeOnly =
      new URL(request.url).searchParams.get("activeOnly") === "true";
    const groups = await listRoleGroups(auth.actor, { activeOnly });
    return NextResponse.json({
      data: groups.map((group) => ({
        id: group.id,
        key: group.key,
        name: group.name,
        description: group.description,
        accessLevel: group.accessLevel,
        permissions: group.permissions,
        isSystem: group.isSystem,
        active: group.active,
        sortOrder: group.sortOrder,
        userCount: group._count.users,
        invitationCount: group._count.invitations,
        updatedAt: group.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const input = createSchema.parse(await readJson(request));
    const group = await createRoleGroup(auth.actor, input);
    return NextResponse.json({ data: group }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
