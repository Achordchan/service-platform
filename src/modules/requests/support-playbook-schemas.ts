import { z } from "zod";

const playbookFields = {
  category: z.enum(["REMOTE", "DIAGNOSTIC", "INFORMATION"]),
  title: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(50_000),
  safetyNotes: z.array(z.string().trim().min(1).max(1_000)).max(20),
  active: z.boolean(),
  sortOrder: z.number().int().min(-10_000).max(10_000),
};

export const createSupportPlaybookSchema = z.object(playbookFields);

export const updateSupportPlaybookSchema = z
  .object(playbookFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "请提供需要修改的内容",
  });

export type CreateSupportPlaybookInput = z.infer<
  typeof createSupportPlaybookSchema
>;
export type UpdateSupportPlaybookInput = z.infer<
  typeof updateSupportPlaybookSchema
>;
