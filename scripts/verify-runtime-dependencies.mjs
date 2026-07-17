import { createRequire } from "node:module";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const requireFromApp = createRequire(resolve("package.json"));
const sharpPackageName = ["sh", "arp"].join("");
let sharp;
try {
  sharp = requireFromApp(sharpPackageName);
} catch (error) {
  throw new Error(
    "无法从应用根依赖加载 sharp，请确认它是主应用的生产依赖",
    { cause: error },
  );
}

if (!sharp?.versions?.sharp || !sharp?.versions?.webp) {
  throw new Error("sharp 已加载，但 WebP 运行能力不可用");
}

const hashedReferences = await findHashedSharpReferences(
  resolve(".next/server/chunks"),
);
if (hashedReferences.length > 0) {
  throw new Error(
    `Next.js 构建仍引用 Turbopack sharp 哈希别名：${hashedReferences.join(", ")}`,
  );
}

process.stdout.write(
  `sharp runtime ok: source=app-root, sharp=${sharp.versions.sharp}, webp=${sharp.versions.webp}\n`,
);

async function findHashedSharpReferences(directory) {
  const matches = [];
  await visit(directory);
  return matches;

  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
      const source = await readFile(path, "utf8");
      if (/sharp-[a-f0-9]{8,}/i.test(source)) {
        matches.push(path.replace(`${process.cwd()}/`, ""));
      }
    }
  }
}
