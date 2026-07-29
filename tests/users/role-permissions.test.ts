import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERMISSIONS_BY_LEVEL,
  ROLE_PERMISSION_OPTIONS,
  sanitizePermissions,
} from "../../src/modules/users/role-permissions";

describe("角色组权限", () => {
  it("不再向任何后台角色开放手工分配服务请求权限", () => {
    expect(ROLE_PERMISSION_OPTIONS.map((item) => item.key)).not.toContain(
      "request.assign",
    );
    expect(DEFAULT_PERMISSIONS_BY_LEVEL.PROJECT_MANAGER).not.toContain(
      "request.assign",
    );
    expect(DEFAULT_PERMISSIONS_BY_LEVEL.TECHNICIAN).not.toContain(
      "request.assign",
    );
  });

  it("保存旧角色组时会清除遗留的分配权限", () => {
    expect(
      sanitizePermissions(
        ["project.view", "request.assign", "request.reply"],
        "PROJECT_MANAGER",
      ),
    ).toEqual(["project.view", "request.reply"]);
  });
});
