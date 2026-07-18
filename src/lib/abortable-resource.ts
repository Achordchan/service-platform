type AbortableResourceOptions = {
  signal: AbortSignal;
  acquire: () => Promise<() => void>;
  onAbort: () => void;
};

export async function acquireAbortableResource({
  signal,
  acquire,
  onAbort,
}: AbortableResourceOptions) {
  if (signal.aborted) {
    onAbort();
    return () => undefined;
  }

  let release: (() => void) | undefined;
  let releaseRequested = false;
  let releaseCompleted = false;
  let abortHandled = false;
  const releaseOnce = () => {
    releaseRequested = true;
    if (releaseCompleted || !release) return;
    releaseCompleted = true;
    release();
  };
  const handleAbort = () => {
    if (!abortHandled) {
      abortHandled = true;
      onAbort();
    }
    releaseOnce();
  };

  signal.addEventListener("abort", handleAbort);
  try {
    release = await acquire();
    if (signal.aborted) handleAbort();
    else if (releaseRequested) releaseOnce();
  } catch (error) {
    signal.removeEventListener("abort", handleAbort);
    throw error;
  }

  return () => {
    signal.removeEventListener("abort", handleAbort);
    releaseOnce();
  };
}
