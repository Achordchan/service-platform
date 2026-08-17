import { z } from "zod";

export const miniappLoginSchema = z.object({
  code: z.string().min(1).max(256),
});

export const miniappBindAccountSchema = z
  .object({
    bindingTicket: z.string().min(10).max(200),
    email: z.string().trim().toLowerCase().pipe(z.email("请输入有效邮箱")),
    password: z.string().min(1).max(128).optional(),
    otp: z.string().regex(/^\d{6}$/, "验证码为 6 位数字").optional(),
  })
  .refine(
    (value) => (value.password !== undefined) !== (value.otp !== undefined),
    { message: "请提供密码或验证码其中一种", path: ["password"] },
  );

export const miniappBindCodeSchema = z.object({
  bindingTicket: z.string().min(10).max(200),
  code: z
    .string()
    .trim()
    .min(8)
    .max(20)
    .regex(/^[A-Za-z0-9-]+$/, "绑定码格式不正确"),
});

export const miniappBindOtpSendSchema = z.object({
  bindingTicket: z.string().min(10).max(200),
  email: z.string().trim().toLowerCase().pipe(z.email("请输入有效邮箱")),
});

export type MiniappLoginInput = z.infer<typeof miniappLoginSchema>;
export type MiniappBindAccountInput = z.infer<typeof miniappBindAccountSchema>;
export type MiniappBindCodeInput = z.infer<typeof miniappBindCodeSchema>;
export type MiniappBindOtpSendInput = z.infer<typeof miniappBindOtpSendSchema>;
