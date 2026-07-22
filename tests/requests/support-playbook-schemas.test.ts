import { describe, expect, it } from "vitest";
import {
  createSupportPlaybookSchema,
  updateSupportPlaybookSchema,
} from "@/modules/requests/support-playbook-schemas";

const validPlaybook = {
  category: "INFORMATION" as const,
  title: "收集部署信息",
  content: "<p>请提供系统版本和复现步骤。</p>",
  safetyNotes: ["不要发送密码或密钥。"],
  active: true,
  sortOrder: 60,
};

describe("support playbook schemas", () => {
  it("accepts a complete playbook", () => {
    expect(createSupportPlaybookSchema.parse(validPlaybook)).toEqual(
      validPlaybook,
    );
  });

  it("rejects empty content and empty updates", () => {
    expect(() =>
      createSupportPlaybookSchema.parse({ ...validPlaybook, content: "" }),
    ).toThrow();
    expect(() => updateSupportPlaybookSchema.parse({})).toThrow();
  });

  it("trims individual safety notes", () => {
    expect(
      updateSupportPlaybookSchema.parse({ safetyNotes: ["  不要发送密码  "] }),
    ).toEqual({ safetyNotes: ["不要发送密码"] });
  });
});
