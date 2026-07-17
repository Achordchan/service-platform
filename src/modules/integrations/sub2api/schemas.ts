import { z } from "zod";

export const sub2ApiConnectionSchema = z.object({
  baseUrl: z.string().trim().min(1).max(2048),
  adminApiKey: z.string().trim().max(512).optional(),
  clearAdminApiKey: z.boolean().optional(),
  emailNotificationsEnabled: z.boolean().default(true),
  customerMemberNotificationsEnabled: z.boolean().default(false),
  activate: z.boolean().default(false),
});

export const sub2ApiConnectionPatchSchema = sub2ApiConnectionSchema
  .partial()
  .extend({
    status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  });

export const externalContactPatchSchema = z.object({
  status: z.enum(["ACTIVE", "BLOCKED"]),
});

export const sub2ApiExchangeSchema = z.object({
  publicId: z.string().trim().min(1).max(128),
  userId: z.union([z.string(), z.number()]).transform(String),
  token: z.string().trim().min(16).max(16_384),
  srcHost: z.string().trim().max(2048).optional(),
});

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
  z.object({ action: z.literal("heartbeat"), sessionId: z.string().min(8).max(120) }),
  z.object({ action: z.literal("leave"), sessionId: z.string().min(8).max(120) }),
  z.object({
    action: z.literal("typing"),
    sessionId: z.string().min(8).max(120),
    typing: z.boolean(),
  }),
]);
