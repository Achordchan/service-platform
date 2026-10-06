import { z } from "zod";
import { dateBound } from "@/modules/http/date-bound";
import { SYSTEM_ERROR_PAGE_SIZE_MAX } from "@/modules/system-errors/system-error-limits";

const optionalText = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((value) => (value ? value : undefined));

/** 列表与导出共用的筛选参数；空串当作没传 */
export const systemErrorFilterSchema = z.object({
  referenceId: optionalText,
  category: optionalText,
  source: optionalText,
  operation: optionalText,
  actorType: optionalText,
  search: optionalText,
  from: dateBound("start"),
  to: dateBound("end"),
});

export const systemErrorListQuerySchema = systemErrorFilterSchema.extend({
  page: z.coerce.number().int().min(0).default(0),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(SYSTEM_ERROR_PAGE_SIZE_MAX)
    .default(25),
});

export function searchParamsToObject(searchParams: URLSearchParams) {
  return Object.fromEntries(
    [...searchParams.entries()].filter(([, value]) => value !== ""),
  );
}
