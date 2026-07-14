import { ensureInlineMailWorker } from "@/lib/jobs";

async function main() {
  await ensureInlineMailWorker();
  process.stdout.write("邮件任务 worker 已启动（可独立运行，本地默认不必再开）\n");
}

main().catch((error) => {
  process.stderr.write(
    `后台任务启动失败：${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
