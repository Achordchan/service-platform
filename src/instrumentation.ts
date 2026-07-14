export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  try {
    const { ensureInlineMailWorker } = await import("@/lib/jobs");
    await ensureInlineMailWorker();
  } catch (error) {
    // Do not crash the app if the queue is temporarily unavailable.
    console.error(
      "邮件 worker 启动延后：",
      error instanceof Error ? error.message : error,
    );
  }
}
