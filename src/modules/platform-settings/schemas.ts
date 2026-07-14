import { z } from "zod";

export const updatePlatformSettingsSchema = z
  .object({
    appUrl: z.string().url().optional().or(z.literal("")),
    mailMode: z.enum(["LOCAL_OUTBOX", "SMTP"]).optional(),
    smtpHost: z.string().max(255).optional().or(z.literal("")),
    smtpPort: z.coerce.number().int().min(1).max(65535).optional().nullable(),
    smtpUser: z.string().max(255).optional().or(z.literal("")),
    smtpPassword: z.string().max(255).optional().or(z.literal("")),
    smtpFrom: z.string().max(255).optional().or(z.literal("")),
    smtpSecure: z.boolean().optional(),
    attachmentMaxSizeMb: z.coerce.number().int().min(1).max(100).optional(),
    attachmentAllowedExtensions: z.string().max(500).optional(),
    customerReplyAttachmentsEnabled: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mailMode !== "SMTP") return;
    if (!value.smtpHost?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["smtpHost"],
        message: "SMTP 模式下必须填写主机",
      });
    }
    if (!value.smtpPort) {
      ctx.addIssue({
        code: "custom",
        path: ["smtpPort"],
        message: "SMTP 模式下必须填写端口",
      });
    }
    if (!value.smtpFrom?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["smtpFrom"],
        message: "SMTP 模式下必须填写发件人",
      });
    }
  });

export type UpdatePlatformSettingsInput = z.infer<
  typeof updatePlatformSettingsSchema
>;
