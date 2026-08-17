import { z } from "zod";

// 弱网重试防重复：客户端为每次提交生成随机 key（如 UUID），服务端按 (作者, key) 幂等
export const clientMutationKeySchema = z.string().trim().min(8).max(128);

export const createRequestSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(20_000),
  categoryId: z.string().trim().min(1),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  clientMutationKey: clientMutationKeySchema.optional(),
});

export const assignRequestSchema = z
  .object({
    assigneeIds: z.array(z.string().trim().min(1)).max(20).optional(),
    assigneeId: z.string().trim().min(1).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.assigneeIds === undefined && value.assigneeId === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "请提供处理人",
        path: ["assigneeIds"],
      });
    }
  });

export const changeRequestStatusSchema = z.object({
  status: z.enum([
    "PENDING",
    "IN_PROGRESS",
    "WAITING_CUSTOMER",
    "RESOLVED",
    "CLOSED",
  ]),
});

export const changeRequestArchiveSchema = z.object({
  archived: z.boolean(),
});

export const createRequestMessageSchema = z.object({
  body: z.string().max(50_000).default(""),
  visibility: z
    .enum(["CUSTOMER_VISIBLE", "INTERNAL"])
    .default("CUSTOMER_VISIBLE"),
  replyToMessageId: z.string().trim().min(1).nullable().optional(),
  supportPlaybookKey: z.string().trim().min(1).max(100).optional(),
  clientMutationKey: clientMutationKeySchema.optional(),
});

const requestPresenceSessionSchema = z.object({
  sessionId: z.string().trim().min(8).max(120),
});

export const requestPresenceSchema = z.discriminatedUnion("action", [
  requestPresenceSessionSchema.extend({
    action: z.literal("heartbeat"),
  }),
  requestPresenceSessionSchema.extend({
    action: z.literal("leave"),
  }),
  requestPresenceSessionSchema.extend({
    action: z.literal("typing"),
    typing: z.boolean(),
    visibility: z
      .enum(["CUSTOMER_VISIBLE", "INTERNAL"])
      .default("CUSTOMER_VISIBLE"),
  }),
]);

export type CreateRequestInput = z.infer<typeof createRequestSchema>;
export type CreateRequestMessageInput = z.infer<
  typeof createRequestMessageSchema
>;
export type AssignRequestInput = z.infer<typeof assignRequestSchema>;
export type RequestPresenceInput = z.infer<typeof requestPresenceSchema>;
