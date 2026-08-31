import { describe, expect, it } from "vitest";
import {
  CONTENT_REEDIT_WINDOW_MS,
  contentReeditExpiresAt,
  isWithinContentReeditWindow,
} from "@/lib/content-reedit-window";

describe("撤回内容的重新编辑时限", () => {
  it("截止时刻从撤回时刻起算", () => {
    const revokedAt = new Date("2026-08-31T10:00:00.000Z");
    expect(contentReeditExpiresAt(revokedAt)?.toISOString()).toBe(
      new Date(revokedAt.getTime() + CONTENT_REEDIT_WINDOW_MS).toISOString(),
    );
    expect(contentReeditExpiresAt(revokedAt.toISOString())?.toISOString()).toBe(
      new Date(revokedAt.getTime() + CONTENT_REEDIT_WINDOW_MS).toISOString(),
    );
  });

  it("没有撤回时刻或时刻非法时不给窗口", () => {
    expect(contentReeditExpiresAt(null)).toBeNull();
    expect(contentReeditExpiresAt(undefined)).toBeNull();
    expect(contentReeditExpiresAt("不是时间")).toBeNull();
    expect(isWithinContentReeditWindow(null)).toBe(false);
  });

  it("窗口内可编辑，到点即关闭", () => {
    const revokedAt = new Date("2026-08-31T10:00:00.000Z");
    const revokedAtMs = revokedAt.getTime();
    expect(isWithinContentReeditWindow(revokedAt, revokedAtMs)).toBe(true);
    expect(
      isWithinContentReeditWindow(
        revokedAt,
        revokedAtMs + CONTENT_REEDIT_WINDOW_MS - 1,
      ),
    ).toBe(true);
    expect(
      isWithinContentReeditWindow(
        revokedAt,
        revokedAtMs + CONTENT_REEDIT_WINDOW_MS,
      ),
    ).toBe(false);
  });
});
