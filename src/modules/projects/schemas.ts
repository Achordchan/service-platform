import { z } from "zod";

const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional();

const optionalDate = z.iso.datetime().nullable().optional();
const optionalSlaMinutes = z
  .number()
  .int()
  .min(1)
  .max(525_600)
  .nullable()
  .optional();

export const createServiceTypeSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/),
  name: z.string().trim().min(1).max(100),
  description: optionalText(1000),
  active: z.boolean().optional(),
  slaResponseMinutes: optionalSlaMinutes,
  slaResolutionMinutes: optionalSlaMinutes,
});

export const updateServiceTypeSchema = createServiceTypeSchema
  .omit({ key: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "至少提交一个修改字段",
  });

export const createRequestCategorySchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: optionalText(1000),
  active: z.boolean().optional(),
});

export const updateRequestCategorySchema = createRequestCategorySchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "至少提交一个修改字段",
  });

const projectFieldsSchema = z.object({
  kind: z.enum(["STANDARD", "EXTERNAL_INTEGRATION"]).optional(),
  title: z.string().trim().min(1).max(200),
  description: optionalText(5000),
  status: z
    .enum(["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "EXPIRED"])
    .optional(),
  currentStage: optionalText(120),
  showMilestones: z.boolean().optional(),
  showProgress: z.boolean().optional(),
  customerUpdatesEnabled: z.boolean().optional(),
  customerRequestsEnabled: z.boolean().optional(),
  customerFilesEnabled: z.boolean().optional(),
  startDate: optionalDate,
  endDate: optionalDate,
  customerSpaceId: z.cuid().optional(),
  connectorPluginKey: z.string().trim().min(1).max(100).optional(),
  serviceTypeId: z.cuid(),
});

export const createProjectSchema = projectFieldsSchema
  .omit({ status: true, currentStage: true })
  .extend({
    managerUserIds: z.array(z.cuid()).max(20).optional(),
  })
  .refine(
    (value) =>
      !value.startDate ||
      !value.endDate ||
      new Date(value.endDate) >= new Date(value.startDate),
    { message: "结束日期不能早于开始日期", path: ["endDate"] },
  )
  .superRefine((value, context) => {
    const kind = value.kind ?? "STANDARD";
    if (kind === "STANDARD" && !value.customerSpaceId) {
      context.addIssue({
        code: "custom",
        message: "标准项目必须选择客户",
        path: ["customerSpaceId"],
      });
    }
    if (kind === "EXTERNAL_INTEGRATION" && value.customerSpaceId) {
      context.addIssue({
        code: "custom",
        message: "外部接入项目由系统管理接入空间，不能绑定普通客户",
        path: ["customerSpaceId"],
      });
    }
    if (kind === "STANDARD" && value.connectorPluginKey) {
      context.addIssue({
        code: "custom",
        message: "标准项目不能绑定外部连接器",
        path: ["connectorPluginKey"],
      });
    }
  });

export const updateProjectSchema = projectFieldsSchema
  .omit({ currentStage: true, customerSpaceId: true, serviceTypeId: true })
  .partial()
  .refine(
    (value) =>
      !value.startDate ||
      !value.endDate ||
      new Date(value.endDate) >= new Date(value.startDate),
    { message: "结束日期不能早于开始日期", path: ["endDate"] },
  )
  .refine((value) => Object.keys(value).length > 0, {
    message: "至少提交一个修改字段",
  });

export const updateProjectStageSchema = z
  .object({
    currentStage: optionalText(120),
  })
  .refine((value) => Object.hasOwn(value, "currentStage"), {
    message: "请提交当前阶段",
  });

export const addProjectStaffSchema = z.object({
  userId: z.cuid(),
  role: z.enum(["PROJECT_MANAGER", "TECHNICIAN"]),
});

export const updateProjectStaffSchema = z.object({
  role: z.enum(["PROJECT_MANAGER", "TECHNICIAN"]),
});

const milestoneFieldsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: optionalText(20_000),
  status: z
    .enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETED"])
    .optional(),
  startDate: optionalDate,
  endDate: optionalDate,
  sortOrder: z.number().int().min(0).max(100000).optional(),
});

export const createMilestoneSchema = milestoneFieldsSchema
  .refine(
    (value) =>
      !value.startDate ||
      !value.endDate ||
      new Date(value.endDate) >= new Date(value.startDate),
    { message: "结束日期不能早于开始日期", path: ["endDate"] },
  );

export const updateMilestoneSchema = milestoneFieldsSchema
  .partial()
  .refine(
    (value) =>
      !value.startDate ||
      !value.endDate ||
      new Date(value.endDate) >= new Date(value.startDate),
    { message: "结束日期不能早于开始日期", path: ["endDate"] },
  )
  .refine((value) => Object.keys(value).length > 0, {
    message: "至少提交一个修改字段",
  });

export const createProjectUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20000),
  visibility: z.enum(["CUSTOMER_VISIBLE", "INTERNAL"]).optional(),
});

export const updateProjectUpdateSchema = createProjectUpdateSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "至少提交一个修改字段",
  });

export const createUpdateCommentSchema = z.object({
  body: z.string().trim().min(1).max(10000),
  visibility: z.enum(["CUSTOMER_VISIBLE", "INTERNAL"]).optional(),
});

export const updateUpdateCommentSchema = createUpdateCommentSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "至少提交一个修改字段",
  });

export const createMilestoneCommentSchema = createUpdateCommentSchema;
export const updateMilestoneCommentSchema = updateUpdateCommentSchema;

export type CreateServiceTypeInput = z.infer<
  typeof createServiceTypeSchema
>;
export type UpdateServiceTypeInput = z.infer<
  typeof updateServiceTypeSchema
>;
export type CreateRequestCategoryInput = z.infer<
  typeof createRequestCategorySchema
>;
export type UpdateRequestCategoryInput = z.infer<
  typeof updateRequestCategorySchema
>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type UpdateProjectStageInput = z.infer<typeof updateProjectStageSchema>;
export type AddProjectStaffInput = z.infer<typeof addProjectStaffSchema>;
export type UpdateProjectStaffInput = z.infer<
  typeof updateProjectStaffSchema
>;
export type CreateMilestoneInput = z.infer<typeof createMilestoneSchema>;
export type UpdateMilestoneInput = z.infer<typeof updateMilestoneSchema>;
export type CreateProjectUpdateInput = z.infer<
  typeof createProjectUpdateSchema
>;
export type UpdateProjectUpdateInput = z.infer<
  typeof updateProjectUpdateSchema
>;
export type CreateUpdateCommentInput = z.infer<
  typeof createUpdateCommentSchema
>;
export type UpdateUpdateCommentInput = z.infer<
  typeof updateUpdateCommentSchema
>;
export type CreateMilestoneCommentInput = z.infer<
  typeof createMilestoneCommentSchema
>;
export type UpdateMilestoneCommentInput = z.infer<
  typeof updateMilestoneCommentSchema
>;
