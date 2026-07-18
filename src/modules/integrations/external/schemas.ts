import { z } from "zod";

export const embedCreateRequestSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(20_000),
  categoryId: z.string().trim().min(1),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
});

export const embedMessageSchema = z.object({
  body: z.string().min(1).max(50_000),
  replyToMessageId: z.string().trim().min(1).nullable().optional(),
});

export const embedPresenceSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("heartbeat"),
    sessionId: z.string().min(8).max(120),
  }),
  z.object({
    action: z.literal("leave"),
    sessionId: z.string().min(8).max(120),
  }),
  z.object({
    action: z.literal("typing"),
    sessionId: z.string().min(8).max(120),
    typing: z.boolean(),
  }),
]);

export const externalContactPatchSchema = z.object({
  status: z.enum(["ACTIVE", "BLOCKED"]),
});

export const externalContactListQuerySchema = z.object({
  keyword: z.string().trim().max(160).optional(),
  status: z.enum(["ACTIVE", "BLOCKED"]).optional(),
  cursor: z.string().trim().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
