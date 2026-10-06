import { NextResponse } from "next/server";
import {
  getSystemErrorFacets,
  listSystemErrors,
} from "@/modules/system-errors/system-error-query";
import {
  searchParamsToObject,
  systemErrorListQuerySchema,
} from "@/modules/system-errors/system-error-filters";
import {
  systemErrorActorTypeLabel,
  systemErrorCategoryLabel,
} from "@/modules/system-errors/system-error-labels";
import { requireApiActor, routeError } from "@/modules/projects/api-utils";

export async function GET(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const url = new URL(request.url);
    const filters = systemErrorListQuerySchema.parse(
      searchParamsToObject(url.searchParams),
    );
    const [page, facets] = await Promise.all([
      listSystemErrors(auth.actor, filters),
      url.searchParams.get("withFacets") === "1"
        ? getSystemErrorFacets(auth.actor)
        : Promise.resolve(undefined),
    ]);

    // 中文标签由服务端统一提供，Web 与后续小程序不必各抄一份分类字典
    const rows = page.rows.map((row) => ({
      ...row,
      categoryLabel: systemErrorCategoryLabel(row.category),
      actorTypeLabel: systemErrorActorTypeLabel(row.actorType),
    }));
    return NextResponse.json({
      data: {
        ...page,
        rows,
        facets: facets
          ? {
              ...facets,
              categoryOptions: facets.categories.map((value) => ({
                value,
                label: systemErrorCategoryLabel(value),
              })),
            }
          : undefined,
      },
    });
  } catch (error) {
    return routeError(error, { operation: "system_errors.list", request });
  }
}

