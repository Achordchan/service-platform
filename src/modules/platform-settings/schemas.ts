import { z } from "zod";

export const updatePlatformSettingsSchema = z
  .object({
    appUrl: z.string().url().optional().or(z.literal("")),
    mailMode: z.enum(["LOCAL_OUTBOX", "RESEND", "SMTP"]).optional(),
    mailFrom: z
      .literal("服务支持中心 <no-reply@mail.achord.cn>")
      .optional(),
    mailReplyTo: z.literal("support@achord.cn").optional(),
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
    const configuringSmtp =
      value.mailMode === "SMTP" ||
      value.smtpHost !== undefined ||
      value.smtpPort !== undefined ||
      value.smtpFrom !== undefined ||
      value.smtpUser !== undefined ||
      value.smtpPassword !== undefined ||
      value.smtpSecure !== undefined;

    if (!configuringSmtp) return;

    if (value.smtpHost !== undefined && !value.smtpHost.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["smtpHost"],
        message: "请填写 SMTP 主机",
      });
    }
    if (value.smtpPort !== undefined && !value.smtpPort) {
      ctx.addIssue({
        code: "custom",
        path: ["smtpPort"],
        message: "请填写 SMTP 端口",
      });
    }
    if (value.smtpFrom !== undefined && !value.smtpFrom.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["smtpFrom"],
        message: "请填写发件人",
      });
    }
    if (value.smtpUser !== undefined && !value.smtpUser.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["smtpUser"],
        message: "请填写 SMTP 用户名",
      });
    }
  });

export type UpdatePlatformSettingsInput = z.infer<
  typeof updatePlatformSettingsSchema
>;

export const setupResendSchema = z.object({
  apiKey: z.string().trim().min(8).max(255).optional(),
});

export const testMailSchema = z.object({
  to: z.string().trim().email().max(255).optional(),
});
