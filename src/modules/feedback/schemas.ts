import { z } from "zod";

export const FEEDBACK_TITLE_MAX = 120;
export const FEEDBACK_CONTENT_MAX = 5_000;
export const FEEDBACK_PAGE_SIZE_MAX = 100;

/** 小程序端上报的运行环境信息（仅用于 issue 正文与后台展示，全部可选、限长）。 */
export const miniappRuntimeSchema = z.object({
  appVersion: z.string().trim().max(40).optional(),
  model: z.string().trim().max(100).optional(),
  system: z.string().trim().max(100).optional(),
  platform: z.string().trim().max(20).optional(),
  sdkVersion: z.string().trim().max(40).optional(),
});

export type MiniappRuntime = z.infer<typeof miniappRuntimeSchema>;

export const submitFeedbackSchema = z.object({
  title: z.string().trim().min(1).max(FEEDBACK_TITLE_MAX),
  content: z.string().trim().min(1).max(FEEDBACK_CONTENT_MAX),
  miniappRuntime: miniappRuntimeSchema.optional(),
  // 弱网重试防重：与 ServiceRequest 的 clientMutationKeySchema 同一套约定
  clientMutationKey: z.string().trim().min(8).max(128).optional(),
});

export type SubmitFeedbackInput = z.infer<typeof submitFeedbackSchema>;

const optionalText = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((value) => (value ? value : undefined));

export const listFeedbackQuerySchema = z.object({
  source: z.enum(["WEB", "MINIAPP"]).optional(),
  issueStatus: z
    .enum(["PENDING", "CREATED", "FAILED", "SKIPPED"])
    .optional(),
  search: optionalText,
  page: z.coerce.number().int().min(0).default(0),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(FEEDBACK_PAGE_SIZE_MAX)
    .default(25),
});

// 手写而不是 z.infer：optionalText 的 transform 会把 search 变成
// 「必填但可为 undefined」，让省略该字段的调用方过不了类型检查。
export type ListFeedbackQuery = {
  source?: "WEB" | "MINIAPP";
  issueStatus?: "PENDING" | "CREATED" | "FAILED" | "SKIPPED";
  search?: string;
  page?: number;
  pageSize?: number;
};
