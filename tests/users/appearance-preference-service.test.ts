import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/actor";

const mocks = vi.hoisted(() => ({
  findUniqueOrThrow: vi.fn(),
  update: vi.fn(),
  writeAuditLog: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/actor", () => ({
  withActorDb: (_actor: Actor, callback: (tx: unknown) => unknown) =>
    callback({
      user: {
        findUniqueOrThrow: mocks.findUniqueOrThrow,
        update: mocks.update,
      },
    }),
}));

vi.mock("@/modules/audit/audit-service", () => ({
  writeAuditLog: mocks.writeAuditLog,
}));

import {
  appearancePreferenceSchema,
  getAppearancePreference,
  updateAppearancePreference,
} from "@/modules/users/appearance-preference-service";

const actor: Actor = {
  id: "user-1",
  name: "测试用户",
  email: "user@example.test",
  platformRole: "CUSTOMER",
  isPlatformAdmin: false,
  isStaff: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("appearance preference service", () => {
  it("only accepts the supported appearance modes", () => {
    expect(
      appearancePreferenceSchema.parse({ themePreference: "SYSTEM" }),
    ).toEqual({ themePreference: "SYSTEM" });
    expect(() =>
      appearancePreferenceSchema.parse({ themePreference: "AUTO" }),
    ).toThrow();
  });

  it("reads the current user's preference", async () => {
    mocks.findUniqueOrThrow.mockResolvedValue({ themePreference: "DARK" });

    await expect(getAppearancePreference(actor)).resolves.toEqual({
      themePreference: "DARK",
    });
    expect(mocks.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: actor.id },
      select: { themePreference: true },
    });
  });

  it("updates the current user and records an audit log", async () => {
    mocks.update.mockResolvedValue({ themePreference: "LIGHT" });

    await expect(
      updateAppearancePreference(actor, { themePreference: "LIGHT" }),
    ).resolves.toEqual({ themePreference: "LIGHT" });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: actor.id },
      data: { themePreference: "LIGHT" },
      select: { themePreference: true },
    });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      actor,
      {
        action: "APPEARANCE_PREFERENCE_UPDATED",
        resourceType: "User",
        resourceId: actor.id,
        metadata: { themePreference: "LIGHT" },
      },
    );
  });
});
