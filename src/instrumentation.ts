export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  try {
    const { isInlineMailWorkerEnabled, startMailWorker } = await import(
      "@/lib/jobs"
    );
    if (isInlineMailWorkerEnabled()) {
      await startMailWorker();
    }
  } catch (error) {
    // Do not crash the app if the queue is temporarily unavailable.
    const { describeErrorForLog } = await import("@/lib/error-log");
    console.error(
      "ACHORD_MAIL_WORKER_START_DEFERRED",
      JSON.stringify({
        event: "mail_worker.start_deferred",
        error: describeErrorForLog(error),
      }),
    );
  }
}
