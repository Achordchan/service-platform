import { describe, expect, it } from "vitest";
import {
  createProjectSchema,
  updateProjectSchema,
  updateProjectStageSchema,
} from "@/modules/projects/schemas";

const serviceTypeId = "cjld2cjxh0000qzrmn831i7rn";
const customerSpaceId = "cjld2cjxh0001qzrmn831i7ro";

describe("项目创建参数", () => {
  it("外部接入项目不要求客户空间", () => {
    expect(
      createProjectSchema.parse({
        title: "Sub2API 项目",
        kind: "EXTERNAL_INTEGRATION",
        serviceTypeId,
      }),
    ).not.toHaveProperty("customerSpaceId");
  });

  it("拒绝把外部接入项目绑定到普通客户", () => {
    expect(() =>
      createProjectSchema.parse({
        title: "Sub2API 项目",
        kind: "EXTERNAL_INTEGRATION",
        serviceTypeId,
        customerSpaceId,
      }),
    ).toThrow("外部接入项目由系统管理接入空间");
  });

  it("标准项目仍然必须选择客户", () => {
    expect(() =>
      createProjectSchema.parse({
        title: "标准项目",
        kind: "STANDARD",
        serviceTypeId,
      }),
    ).toThrow("标准项目必须选择客户");
  });

  it("创建时忽略由系统管理的状态和当前阶段", () => {
    const result = createProjectSchema.parse({
      title: "标准项目",
      kind: "STANDARD",
      serviceTypeId,
      customerSpaceId,
      status: "DRAFT",
      currentStage: "已付款",
    });

    expect(result).not.toHaveProperty("status");
    expect(result).not.toHaveProperty("currentStage");
  });

  it("接受客户中心模块开关", () => {
    expect(
      updateProjectSchema.parse({
        customerUpdatesEnabled: false,
        customerRequestsEnabled: false,
        customerFilesEnabled: false,
      }),
    ).toEqual({
      customerUpdatesEnabled: false,
      customerRequestsEnabled: false,
      customerFilesEnabled: false,
    });
  });

  it("项目常规更新不接受阶段字段", () => {
    const result = updateProjectSchema.parse({
      title: "更新后的项目",
      currentStage: "测试验收",
    });

    expect(result).toEqual({ title: "更新后的项目" });
  });

  it("阶段更新允许设置或清空阶段", () => {
    expect(
      updateProjectStageSchema.parse({ currentStage: "测试验收" }),
    ).toEqual({ currentStage: "测试验收" });
    expect(updateProjectStageSchema.parse({ currentStage: null })).toEqual({
      currentStage: null,
    });
    expect(() => updateProjectStageSchema.parse({})).toThrow("请提交当前阶段");
  });
});
