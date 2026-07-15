import { NextResponse } from "next/server";
import { z } from "zod";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";
import {
  deactivateStaffUser,
  updateStaffProfile,
} from "@/modules/users/staff-invitation-service";

const updateSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  roleGroupId: z.string().min(1).optional().nullable(),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  company: z.string().trim().max(120).optional().or(z.literal("")),
  jobTitle: z.string().trim().max(80).optional().or(z.literal("")),
  wechat: z.string().trim().max(80).optional().or(z.literal("")),
  website: z.string().trim().max(200).optional().or(z.literal("")),
  location: z.string().trim().max(120).optional().or(z.literal("")),
  contactNotes: z.string().trim().max(500).optional().or(z.literal("")),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { userId } = await context.params;
    const input = updateSchema.parse(await readJson(request));
    const user = await updateStaffProfile(auth.actor, userId, input);
    return NextResponse.json({
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        platformRole: user.platformRole,
        phone: user.phone,
        company: user.company,
        jobTitle: user.jobTitle,
        wechat: user.wechat,
        website: user.website,
        location: user.location,
        contactNotes: user.contactNotes,
        roleGroupId: user.roleGroupId,
        roleGroupName: user.roleGroup?.name ?? null,
        projectCount: user._count.projectAssignments,
      },
    });
  } catch (error) {
    return routeError(error);
  }
}


export async function DELETE(
  _request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { userId } = await context.params;
    await deactivateStaffUser(auth.actor, userId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return routeError(error);
  }
}
