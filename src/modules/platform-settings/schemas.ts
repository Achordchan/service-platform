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
    const configuringMail =
      value.mailMode === "SMTP" ||
      value.smtpHost !== undefined ||
      value.smtpPort !== undefined ||
      value.smtpFrom !== undefined ||
      value.smtpUser !== undefined ||
      value.smtpPassword !== undefined ||
      value.smtpSecure !== undefined;

    if (!configuringMail) return;

    // Production UI only configures SMTP. Reject local outbox updates from admin form.
    if (value.mailMode === "LOCAL_OUTBOX") {
      ctx.addIssue({
        code: "custom",
        path: ["mailMode"],
        message: "正式环境请使用 SMTP 外发",
      });
      return;
    }

    if (!value.smtpHost?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["smtpHost"],
        message: "请填写 SMTP 主机",
      });
    }
    if (!value.smtpPort) {
      ctx.addIssue({
        code: "custom",
        path: ["smtpPort"],
        message: "请填写 SMTP 端口",
      });
    }
    if (!value.smtpFrom?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["smtpFrom"],
        message: "请填写发件人",
      });
    }
    if (!value.smtpUser?.trim()) {
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
