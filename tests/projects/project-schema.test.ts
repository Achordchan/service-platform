import { describe, expect, it } from "vitest";
import { createProjectSchema } from "@/modules/projects/schemas";

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
});
