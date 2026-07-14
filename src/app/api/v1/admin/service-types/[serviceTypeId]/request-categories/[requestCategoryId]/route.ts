import { NextResponse } from "next/server";
import { updateRequestCategory } from "@/modules/projects/service-type-service";
import { updateRequestCategorySchema } from "@/modules/projects/schemas";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

type RouteContext = {
  params: Promise<{
    serviceTypeId: string;
    requestCategoryId: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { serviceTypeId, requestCategoryId } = await context.params;
    const input = updateRequestCategorySchema.parse(await readJson(request));
    const category = await updateRequestCategory(
      auth.actor,
      serviceTypeId,
      requestCategoryId,
      input,
    );
    return NextResponse.json({ data: category });
  } catch (error) {
    return routeError(error);
  }
}
