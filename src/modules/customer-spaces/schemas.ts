import { z } from "zod";

const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const createCustomerSpaceSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    slug: z
      .union([slugSchema, z.literal(""), z.undefined()])
      .optional()
      .transform((value) => {
        if (!value) return undefined;
        return value;
      }),
    ownerId: z.cuid().optional(),
    ownerName: z.string().trim().min(2).max(60).optional(),
    ownerEmail: z.email().trim().toLowerCase().optional(),
    memberLimit: z.number().int().min(1).max(1000).optional(),
    status: z.enum(["ACTIVE", "SUSPENDED", "ARCHIVED"]).optional(),
  })
  .superRefine((value, context) => {
    const usesExistingOwner = Boolean(value.ownerId);
    const createsOwner = Boolean(value.ownerName && value.ownerEmail);
    if (usesExistingOwner === createsOwner) {
      context.addIssue({
        code: "custom",
        message: "必须选择现有客户，或填写新客户姓名和邮箱",
        path: ["ownerId"],
      });
    }
  });

export const updateCustomerSpaceSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    slug: slugSchema.optional(),
    ownerId: z.cuid().optional(),
    memberLimit: z.number().int().min(1).max(1000).optional(),
    status: z.enum(["ACTIVE", "SUSPENDED", "ARCHIVED"]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "至少提交一个修改字段",
  });

export const createInvitationSchema = z.object({
  email: z.email().trim().toLowerCase(),
});

export const updateCustomerSpaceMemberSchema = z.object({
  name: z.string().trim().min(2).max(60),
});

export type CreateCustomerSpaceInput = z.infer<
  typeof createCustomerSpaceSchema
>;
export type UpdateCustomerSpaceInput = z.infer<
  typeof updateCustomerSpaceSchema
>;
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type UpdateCustomerSpaceMemberInput = z.infer<
  typeof updateCustomerSpaceMemberSchema
>;
