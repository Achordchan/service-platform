import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

let worker: ChildProcess | null = null;

afterEach(async () => {
  if (!worker?.pid || worker.exitCode !== null) {
    worker = null;
    return;
  }
  if (process.platform === "win32") {
    worker.kill("SIGTERM");
  } else {
    process.kill(-worker.pid, "SIGTERM");
  }
  await new Promise<void>((resolve) => {
    worker?.once("exit", () => resolve());
    setTimeout(resolve, 3_000);
  });
  worker = null;
});

describe("mail worker startup", () => {
  it("starts outside Next.js without triggering the server-only sentinel", async () => {
    // Use local tsx + process.execPath so the test never re-enters the package
    // manager (pnpm worker can reinstall deps and exceed the startup budget).
    const tsxCli = pathResolve(process.cwd(), "node_modules/tsx/dist/cli.mjs");
    const envFile = existsSync(pathResolve(process.cwd(), ".env.integration"))
      ? ".env.integration"
      : ".env";
    worker = spawn(
      process.execPath,
      [
        tsxCli,
        "--tsconfig",
        "tsconfig.worker.json",
        `--env-file=${envFile}`,
        "src/worker.ts",
      ],
      {
        cwd: process.cwd(),
        detached: process.platform !== "win32",
        env: {
          ...process.env,
          NODE_ENV: "test",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let output = "";
    worker.stdout?.on("data", (chunk) => {
      output += chunk.toString();
    });
    worker.stderr?.on("data", (chunk) => {
      output += chunk.toString();
    });

    await new Promise<void>((resolve, reject) => {
      const check = setInterval(() => {
        if (!output.includes("邮件任务 worker 已启动")) return;
        cleanup();
        resolve();
      }, 100);
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Worker 启动超时：${output}`));
      }, 12_000);
      function cleanup() {
        clearTimeout(timeout);
        clearInterval(check);
      }
      worker?.once("exit", (code) => {
        cleanup();
        reject(new Error(`Worker 提前退出 (${code})：${output}`));
      });
    });

    expect(output).toContain("邮件任务 worker 已启动");
    expect(output).not.toContain("server-only");
  });
});
