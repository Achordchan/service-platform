import { describe, expect, it, vi } from "vitest";
import { acquireAbortableResource } from "@/lib/abortable-resource";

describe("acquireAbortableResource", () => {
  it("releases a resource acquired after the request was aborted", async () => {
    const controller = new AbortController();
    const release = vi.fn();
    const onAbort = vi.fn();
    let resolveAcquire: ((release: () => void) => void) | undefined;
    const pending = acquireAbortableResource({
      signal: controller.signal,
      acquire: () =>
        new Promise<() => void>((resolve) => {
          resolveAcquire = resolve;
        }),
      onAbort,
    });

    controller.abort();
    expect(onAbort).toHaveBeenCalledTimes(1);
    resolveAcquire?.(release);
    const cleanup = await pending;

    expect(release).toHaveBeenCalledTimes(1);
    cleanup();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("releases an active resource once during normal cleanup", async () => {
    const controller = new AbortController();
    const release = vi.fn();
    const cleanup = await acquireAbortableResource({
      signal: controller.signal,
      acquire: async () => release,
      onAbort: vi.fn(),
    });

    cleanup();
    cleanup();
    expect(release).toHaveBeenCalledTimes(1);
  });
});
