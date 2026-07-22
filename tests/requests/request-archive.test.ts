import { describe, expect, it } from "vitest";
import {
  canArchiveRequestStatus,
  matchesRequestArchiveFilter,
} from "@/lib/request-archive";

describe("request archive rules", () => {
  it("only archives resolved or closed requests", () => {
    expect(canArchiveRequestStatus("RESOLVED")).toBe(true);
    expect(canArchiveRequestStatus("CLOSED")).toBe(true);
    expect(canArchiveRequestStatus("IN_PROGRESS")).toBe(false);
  });

  it("hides archived requests from all and status filters", () => {
    const request = {
      status: "CLOSED",
      archivedAt: "2026-07-21T02:00:00.000Z",
    };
    expect(matchesRequestArchiveFilter(request, "ALL")).toBe(false);
    expect(matchesRequestArchiveFilter(request, "CLOSED")).toBe(false);
    expect(matchesRequestArchiveFilter(request, "ARCHIVED")).toBe(true);
  });

  it("keeps active requests in normal filters", () => {
    const request = { status: "IN_PROGRESS", archivedAt: null };
    expect(matchesRequestArchiveFilter(request, "ALL")).toBe(true);
    expect(matchesRequestArchiveFilter(request, "IN_PROGRESS")).toBe(true);
    expect(matchesRequestArchiveFilter(request, "ARCHIVED")).toBe(false);
  });
});
