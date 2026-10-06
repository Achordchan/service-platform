import { NextResponse } from "next/server";
import { getSystemErrorDetail } from "@/modules/system-errors/system-error-query";
import {
  systemErrorActorTypeLabel,
  systemErrorCategoryHint,
  systemErrorCategoryLabel,
} from "@/modules/system-errors/system-error-labels";
import { DomainError } from "@/modules/projects/errors";
import { requireApiActor, routeError } from "@/modules/projects/api-utils";

type RouteContext = { params: Promise<{ referenceId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { referenceId } = await context.params;
    const detail = await getSystemErrorDetail(
      auth.actor,
      decodeURIComponent(referenceId),
    );
    if (!detail) {
      throw new DomainError("SYSTEM_ERROR_NOT_FOUND", "没有找到这个错误编号", 404);
    }
    const label = (row: typeof detail) => ({
      ...row,
      categoryLabel: systemErrorCategoryLabel(row.category),
      actorTypeLabel: systemErrorActorTypeLabel(row.actorType),
    });
    return NextResponse.json({
      data: {
        ...label(detail),
        categoryHint: systemErrorCategoryHint(detail.category) ?? null,
        related: detail.related.map((row) => ({
          ...row,
          categoryLabel: systemErrorCategoryLabel(row.category),
          actorTypeLabel: systemErrorActorTypeLabel(row.actorType),
        })),
      },
    });
  } catch (error) {
    return routeError(error, { operation: "system_errors.get", request });
  }
}
