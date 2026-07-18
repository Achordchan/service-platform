import { z } from "zod";
export {
  embedCreateRequestSchema,
  externalContactPatchSchema,
  embedMessageSchema,
  embedPresenceSchema,
} from "@/modules/integrations/external/schemas";

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

export const sub2ApiExchangeSchema = z.object({
  publicId: z.string().trim().min(1).max(128),
  userId: z.union([z.string(), z.number()]).transform(String),
  token: z.string().trim().min(16).max(16_384),
  srcHost: z.string().trim().max(2048).optional(),
});
