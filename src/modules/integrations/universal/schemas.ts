import { z } from "zod";
import {
  UNIVERSAL_LAUNCH_MODES,
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
  // 只开 Native Launch 的连接可以不配 Origin；「至少一项」在服务层结合现值校验
  allowedOrigins: z.array(z.string().trim().min(1).max(2048)).max(5),
  // 省略时保留现值，旧页面保存配置不会把已开启的 Native Launch 关掉
  allowNativeLaunch: z.boolean().optional(),
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
      launchMode: z.enum(UNIVERSAL_LAUNCH_MODES).optional(),
    })
    .default({}),
});

export const universalExchangeSchema = z.object({
  publicId: z.string().trim().min(1).max(128),
  ticket: z.string().trim().min(16).max(512),
  // native 票据不需要；iframe 票据缺失时由服务层拒绝
  parentOrigin: z.string().trim().min(1).max(2048).optional(),
});

export const universalContactUnreadParamsSchema = z.object({
  externalUserId: z.string().trim().min(1).max(191),
});
