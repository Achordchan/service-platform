import { z } from "zod";

export const mailSettingsFormSchema = z.object({
  apiKey: z.string().max(255, "API Key 长度不能超过 255 个字符"),
  testEmail: z.string().trim().email("请输入有效的测试收件邮箱"),
});

export type MailSettingsFormValues = z.infer<typeof mailSettingsFormSchema>;
