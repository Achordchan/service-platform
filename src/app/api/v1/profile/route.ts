import {
  apiErrorResponse,
  requireApiActor,
} from "@/modules/requests/api";
import {
  updateProfile,
  updateProfileAvatar,
  updateProfileSchema,
} from "@/modules/users/profile-service";

export async function PATCH(request: Request) {
  try {
    const actor = await requireApiActor();
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const name = String(form.get("name") ?? "").trim();
      const file = form.get("avatar");
      let profile = await updateProfile(
        actor,
        updateProfileSchema.parse({ name: name || actor.name }),
      );
      if (file instanceof File && file.size > 0) {
        const buffer = new Uint8Array(await file.arrayBuffer());
        profile = await updateProfileAvatar(actor, {
          fileName: file.name,
          claimedMimeType: file.type,
          buffer,
        });
      }
      return Response.json({ data: profile });
    }

    const input = updateProfileSchema.parse(await request.json());
    const profile = await updateProfile(actor, input);
    return Response.json({ data: profile });
  } catch (error) {
    return apiErrorResponse(error, {
      request,
      operation: "profile.update",
    });
  }
}
