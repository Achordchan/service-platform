import { NextResponse } from "next/server";
import { z } from "zod";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";
import {
  inviteStaff,
  listStaffInvitations,
} from "@/modules/users/staff-invitation-service";

const inviteSchema = z.object({
  email: z.string().trim().email().max(160),
  name: z.string().trim().min(2).max(60),
  roleGroupId: z.string().min(1),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  company: z.string().trim().max(120).optional().or(z.literal("")),
  jobTitle: z.string().trim().max(80).optional().or(z.literal("")),
  wechat: z.string().trim().max(80).optional().or(z.literal("")),
  website: z.string().trim().max(200).optional().or(z.literal("")),
  location: z.string().trim().max(120).optional().or(z.literal("")),
  contactNotes: z.string().trim().max(500).optional().or(z.literal("")),
});

export async function GET() {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const invitations = await listStaffInvitations(auth.actor);
    return NextResponse.json({
      data: invitations.map((invitation) => ({
        id: invitation.id,
        email: invitation.email,
        name: invitation.name,
        phone: invitation.phone,
        company: invitation.company,
        jobTitle: invitation.jobTitle,
        wechat: invitation.wechat,
        website: invitation.website,
        location: invitation.location,
        contactNotes: invitation.contactNotes,
        platformRole: invitation.platformRole,
        roleGroupId: invitation.roleGroupId,
        roleGroupName: invitation.roleGroup?.name ?? null,
        expiresAt: invitation.expiresAt.toISOString(),
        createdAt: invitation.createdAt.toISOString(),
        invitedByName: invitation.invitedBy.name,
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
    const input = inviteSchema.parse(await readJson(request));
    const invitation = await inviteStaff(auth.actor, input);
    return NextResponse.json(
      {
        data: {
          id: invitation.id,
          email: invitation.email,
          name: invitation.name,
          phone: invitation.phone,
          company: invitation.company,
          jobTitle: invitation.jobTitle,
          wechat: invitation.wechat,
          website: invitation.website,
          location: invitation.location,
          contactNotes: invitation.contactNotes,
          platformRole: invitation.platformRole,
          roleGroupId: invitation.roleGroupId,
          roleGroupName: invitation.roleGroup?.name ?? null,
          expiresAt: invitation.expiresAt.toISOString(),
          createdAt: invitation.createdAt.toISOString(),
          invitedByName: invitation.invitedBy.name,
          previewUrl: invitation.previewUrl,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return routeError(error);
  }
}
