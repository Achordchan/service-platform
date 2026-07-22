import { z } from "zod";
import { MAIL_TEMPLATE_KEYS } from "@/modules/platform-settings/mail-template-catalog";

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
    clearSmtpPassword: z.boolean().optional(),
    smtpFrom: z.string().max(255).optional().or(z.literal("")),
    smtpSecure: z.boolean().optional(),
    attachmentMaxSizeMb: z.coerce.number().int().min(1).max(100).optional(),
    attachmentAllowedExtensions: z.string().max(500).optional(),
    customerReplyAttachmentsEnabled: z.boolean().optional(),
    standardRequestEmailEnabled: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.smtpPassword && value.clearSmtpPassword) {
      ctx.addIssue({
        code: "custom",
        path: ["smtpPassword"],
        message: "设置新密码和清除密码不能同时执行",
      });
    }
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
  templateKey: z.enum(MAIL_TEMPLATE_KEYS).optional(),
  deliveryMode: z.enum(["LOCAL_OUTBOX", "RESEND", "SMTP"]).optional(),
});

export const updateMailTemplateSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  previewText: z.string().trim().min(1).max(240),
  heading: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(3000),
  actionLabel: z.string().trim().max(80).nullable(),
});
