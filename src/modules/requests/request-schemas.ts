import { z } from "zod";

export const createRequestSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(20_000),
  categoryId: z.string().trim().min(1),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
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

export const createRequestMessageSchema = z.object({
  body: z.string().min(1).max(50_000),
  visibility: z
    .enum(["CUSTOMER_VISIBLE", "INTERNAL"])
    .default("CUSTOMER_VISIBLE"),
  replyToMessageId: z.string().trim().min(1).nullable().optional(),
});

export const requestPresenceSchema = z.object({
  sessionId: z.string().trim().min(8).max(120),
  action: z.enum(["heartbeat", "leave"]),
});

export type CreateRequestInput = z.infer<typeof createRequestSchema>;
export type CreateRequestMessageInput = z.infer<
  typeof createRequestMessageSchema
>;
export type AssignRequestInput = z.infer<typeof assignRequestSchema>;
export type RequestPresenceInput = z.infer<typeof requestPresenceSchema>;
