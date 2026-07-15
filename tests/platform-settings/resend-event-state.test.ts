import { describe, expect, it } from "vitest";
import {
  resendEventToMessageStatus,
  shouldApplyMailEvent,
} from "../../src/modules/platform-settings/resend-event-state";

describe("Resend event state", () => {
  it("maps tracked email events to outbox statuses", () => {
    expect(resendEventToMessageStatus("email.sent")).toBe("SENT");
    expect(resendEventToMessageStatus("email.delivered")).toBe("DELIVERED");
    expect(resendEventToMessageStatus("email.bounced")).toBe("BOUNCED");
    expect(resendEventToMessageStatus("email.opened")).toBeNull();
  });

  it("ignores older events", () => {
    expect(
      shouldApplyMailEvent({
        currentStatus: "DELIVERED",
        currentEventAt: new Date("2026-07-15T10:01:00Z"),
        nextStatus: "SENT",
        nextEventAt: new Date("2026-07-15T10:00:00Z"),
      }),
    ).toBe(false);
  });

  it("does not downgrade equal-time terminal events", () => {
    const occurredAt = new Date("2026-07-15T10:01:00Z");
    expect(
      shouldApplyMailEvent({
        currentStatus: "COMPLAINED",
        currentEventAt: occurredAt,
        nextStatus: "DELIVERED",
        nextEventAt: occurredAt,
      }),
    ).toBe(false);
  });

  it("does not downgrade a delivered message to delayed", () => {
    expect(
      shouldApplyMailEvent({
        currentStatus: "DELIVERED",
        currentEventAt: new Date("2026-07-15T10:01:00Z"),
        nextStatus: "DELIVERY_DELAYED",
        nextEventAt: new Date("2026-07-15T10:02:00Z"),
      }),
    ).toBe(false);
  });

  it("does not revive an administratively cancelled message", () => {
    expect(
      shouldApplyMailEvent({
        currentStatus: "CANCELLED",
        currentEventAt: new Date("2026-07-15T10:01:00Z"),
        nextStatus: "SENT",
        nextEventAt: new Date("2026-07-15T10:02:00Z"),
      }),
    ).toBe(false);
  });
});
