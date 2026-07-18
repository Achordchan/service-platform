import { z } from "zod";
import {
  UNIVERSAL_MAX_PROFILE_FIELDS,
  UNIVERSAL_WEBHOOK_EVENTS,
} from "@/modules/integrations/universal/constants";

export const universalProfileFieldSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().trim().min(1).max(60),
  type: z.enum(["text", "number", "boolean", "date"]),
});
export type UniversalProfileField = z.infer<
  typeof universalProfileFieldSchema
>;

export const universalConnectionSchema = z.object({
  name: z.string().trim().min(1).max(100),
  allowedOrigins: z.array(z.string().trim().min(1).max(2048)).min(1).max(5),
  profileFields: z
    .array(universalProfileFieldSchema)
    .max(UNIVERSAL_MAX_PROFILE_FIELDS)
    .default([]),
  emailNotificationsEnabled: z.boolean().default(true),
  customerMemberNotificationsEnabled: z.boolean().default(false),
  webhookUrl: z.string().trim().max(2048).nullable().optional(),
  webhookEvents: z
    .array(z.enum(UNIVERSAL_WEBHOOK_EVENTS))
    .max(UNIVERSAL_WEBHOOK_EVENTS.length)
    .default([...UNIVERSAL_WEBHOOK_EVENTS]),
  rotateWebhookSecret: z.boolean().optional(),
  activate: z.boolean().optional(),
});

const attributeValueSchema = z.union([
  z.string().max(500),
  z.number().finite(),
  z.boolean(),
]);

export const universalLaunchTicketSchema = z.object({
  user: z.object({
    id: z.string().trim().min(1).max(191),
    name: z.string().trim().min(1).max(160),
    email: z.string().trim().email().max(320).nullable().optional(),
    username: z.string().trim().min(1).max(160).nullable().optional(),
    avatarUrl: z.string().trim().url().max(2048).nullable().optional(),
    attributes: z.record(z.string(), attributeValueSchema).default({}),
  }),
  context: z
    .object({
      theme: z.enum(["light", "dark", "system"]).optional(),
      locale: z.string().trim().min(2).max(20).optional(),
      returnOrigin: z.string().trim().min(1).max(2048).optional(),
    })
    .default({}),
});

export const universalExchangeSchema = z.object({
  publicId: z.string().trim().min(1).max(128),
  ticket: z.string().trim().min(16).max(512),
  parentOrigin: z.string().trim().min(1).max(2048),
});
