import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/runtime-env", () => ({
  env: { BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0000" },
}));

const {
  EMBED_ATTACHMENT_LINK_TTL_MS,
  createEmbedAttachmentDownloadToken,
  verifyEmbedAttachmentDownloadToken,
} = await import("@/modules/integrations/external/attachment-download-link");

describe("native 门户附件下载链接", () => {
  const now = Date.UTC(2026, 8, 28, 10, 0, 0);

  it("只对签发时的会话和附件有效", () => {
    const { token } = createEmbedAttachmentDownloadToken("session-1", "file-1", now);
    expect(verifyEmbedAttachmentDownloadToken(token, "file-1", now + 1000)).toBe(
      "session-1",
    );
    expect(verifyEmbedAttachmentDownloadToken(token, "file-2", now + 1000)).toBeNull();
  });

  it("过期或被篡改后失效", () => {
    const { token } = createEmbedAttachmentDownloadToken("session-1", "file-1", now);
    expect(
      verifyEmbedAttachmentDownloadToken(
        token,
        "file-1",
        now + EMBED_ATTACHMENT_LINK_TTL_MS,
      ),
    ).toBeNull();
    const [, expiresAt, signature] = token.split(".");
    const forgedSession = Buffer.from("session-2").toString("base64url");
    expect(
      verifyEmbedAttachmentDownloadToken(
        `${forgedSession}.${expiresAt}.${signature}`,
        "file-1",
        now,
      ),
    ).toBeNull();
    const [session] = token.split(".");
    expect(
      verifyEmbedAttachmentDownloadToken(
        `${session}.${Number(expiresAt) + 60_000}.${signature}`,
        "file-1",
        now,
      ),
    ).toBeNull();
    expect(verifyEmbedAttachmentDownloadToken("garbage", "file-1", now)).toBeNull();
  });
});
