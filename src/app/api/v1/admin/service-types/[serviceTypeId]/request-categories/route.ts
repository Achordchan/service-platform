import { NextResponse } from "next/server";
import {
  createRequestCategory,
  listRequestCategories,
} from "@/modules/projects/service-type-service";
import { createRequestCategorySchema } from "@/modules/projects/schemas";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

type RouteContext = {
  params: Promise<{ serviceTypeId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { serviceTypeId } = await context.params;
    const categories = await listRequestCategories(
      auth.actor,
      serviceTypeId,
    );
    return NextResponse.json({ data: categories });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { serviceTypeId } = await context.params;
    const input = createRequestCategorySchema.parse(await readJson(request));
    const category = await createRequestCategory(
      auth.actor,
      serviceTypeId,
      input,
    );
    return NextResponse.json({ data: category }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
