import { createRequire } from "node:module";
import { readdir, realpath } from "node:fs/promises";
import { resolve } from "node:path";

const nextNodeModules = resolve(".next/node_modules");
let entries;
try {
  entries = await readdir(nextNodeModules);
} catch (error) {
  throw new Error(
    "Next.js 构建产物缺少 .next/node_modules，无法验证原生运行时依赖",
    { cause: error },
  );
}
const sharpAlias = entries.find((entry) => entry.startsWith("sharp-"));

if (!sharpAlias) {
  throw new Error("Next.js 构建产物缺少 sharp 运行时别名");
}

const aliasPath = resolve(nextNodeModules, sharpAlias);
const targetPath = await realpath(aliasPath);
const runtimePath = resolve(".next/server/chunks/[turbopack]_runtime.js");
const requireFromServerChunk = createRequire(runtimePath);
let sharp;
try {
  sharp = requireFromServerChunk(sharpAlias);
} catch (error) {
  throw new Error(
    `无法从 Next.js 服务端运行时加载 ${sharpAlias}，请检查部署是否保留 .next/node_modules`,
    { cause: error },
  );
}

if (!sharp?.versions?.sharp || !sharp?.versions?.webp) {
  throw new Error("sharp 已加载，但 WebP 运行能力不可用");
}

process.stdout.write(
  `sharp runtime ok: alias=${sharpAlias}, target=${targetPath}, sharp=${sharp.versions.sharp}, webp=${sharp.versions.webp}\n`,
);
