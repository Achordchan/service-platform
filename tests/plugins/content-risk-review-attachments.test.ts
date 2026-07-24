import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  readPrivateFile: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/system-db", () => ({
  withSystemDb: (callback: (tx: unknown) => unknown) =>
    callback({
      attachment: {
        findMany: mocks.findMany,
        findUnique: mocks.findUnique,
      },
    }),
}));

vi.mock("@/lib/actor", () => ({
  withActorDb: vi.fn(),
}));

vi.mock("@/lib/secret-crypto", () => ({
  decryptSecret: vi.fn(),
}));

vi.mock("@/modules/attachments/private-storage", () => ({
  readPrivateFile: mocks.readPrivateFile,
  removePrivateFile: vi.fn(),
}));

vi.mock("@/modules/audit/audit-service", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("@/modules/notifications/notification-service", () => ({
  publishEvent: vi.fn(),
}));

vi.mock("@/modules/plugins/plugin-installation-service", () => ({
  applyPluginDisableSideEffects: vi.fn(),
}));

vi.mock("@/modules/plugins/plugin-secret-config", () => ({
  decryptPluginSecretConfig: vi.fn(),
}));

vi.mock("@/modules/plugins/content-risk-service", () => ({
  cancelSupersededContentRiskReview: vi.fn(),
  encryptSnapshot: vi.fn(),
  notifyPlatformAdmins: vi.fn(),
}));

import { loadReviewAttachments } from "@/modules/plugins/content-risk-review-service";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("风控附件加载", () => {
  it("附件被 WebP 任务替换后改读最新文件", async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: "attachment-1",
        originalName: "original.png",
        mimeType: "image/png",
        size: 1024,
        storageKey: "requests/1/original.png",
      },
    ]);
    mocks.findUnique.mockResolvedValue({
      originalName: "original.webp",
      mimeType: "image/webp",
      size: 512,
      storageKey: "requests/1/replacement.webp",
    });
    mocks.readPrivateFile
      .mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "ENOENT" }))
      .mockResolvedValueOnce(Buffer.from("webp"));

    const result = await loadReviewAttachments(["attachment-1"]);

    expect(mocks.readPrivateFile).toHaveBeenNthCalledWith(
      1,
      "requests/1/original.png",
    );
    expect(mocks.readPrivateFile).toHaveBeenNthCalledWith(
      2,
      "requests/1/replacement.webp",
    );
    expect(result.skipped).toEqual([]);
    expect(result.attachments).toEqual([
      {
        fileName: "original.webp",
        mimeType: "image/webp",
        data: Buffer.from("webp"),
      },
    ]);
  });

  it("最新文件仍不可读时才记录为不支持附件", async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: "attachment-1",
        originalName: "original.png",
        mimeType: "image/png",
        size: 1024,
        storageKey: "requests/1/original.png",
      },
    ]);
    mocks.findUnique.mockResolvedValue({
      originalName: "original.webp",
      mimeType: "image/webp",
      size: 512,
      storageKey: "requests/1/replacement.webp",
    });
    mocks.readPrivateFile.mockRejectedValue(new Error("storage unavailable"));

    const result = await loadReviewAttachments(["attachment-1"]);

    expect(result.attachments).toEqual([]);
    expect(result.skipped).toEqual([
      {
        fileName: "original.webp",
        mimeType: "image/webp",
        data: new Uint8Array(),
      },
    ]);
  });
});
