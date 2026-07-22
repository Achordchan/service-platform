import { describe, expect, it } from "vitest";
import {
  buildSupportPlaybookMessageBody,
  parseSupportPlaybookSnapshot,
  snapshotSupportReplyPlaybook,
  supportReplyPlaybooks,
} from "@/lib/support-reply-playbooks";

describe("support reply playbooks", () => {
  it("provides unique production playbooks with detailed steps", () => {
    expect(supportReplyPlaybooks.length).toBeGreaterThanOrEqual(5);
    expect(new Set(supportReplyPlaybooks.map((item) => item.key)).size).toBe(
      supportReplyPlaybooks.length,
    );
    expect(
      supportReplyPlaybooks.every(
        (item) => item.steps.length >= 4 && item.safetyNotes.length >= 1,
      ),
    ).toBe(true);
  });

  it("escapes the plain-text fallback message", () => {
    const html = buildSupportPlaybookMessageBody({
      key: "escape-test",
      category: "INFORMATION",
      title: '<script>alert("x")</script>',
      summary: "不要发送 <secret>",
      introduction: "test",
      steps: ["step"],
      safetyNotes: ["test"],
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;secret&gt;");
  });

  it("stores and validates an immutable message snapshot", () => {
    const source = {
      ...supportReplyPlaybooks[0]!,
      active: true,
      sortOrder: 10,
      isBuiltin: true,
      updatedAt: "2026-07-21T00:00:00.000Z",
      deletedAt: null,
      content: "<p>处理正文</p>",
    };
    const snapshot = snapshotSupportReplyPlaybook(source);
    snapshot.steps.push("new step");
    expect(source.steps).not.toContain("new step");
    expect(snapshot).not.toHaveProperty("active");
    expect(snapshot).not.toHaveProperty("sortOrder");
    expect(snapshot).not.toHaveProperty("deletedAt");
    expect(snapshot.content).toBe("<p>处理正文</p>");
    expect(parseSupportPlaybookSnapshot(snapshot)).toEqual(snapshot);
    expect(
      parseSupportPlaybookSnapshot({ ...snapshot, steps: [123] }),
    ).toBeNull();
  });
});
