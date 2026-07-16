import "server-only";

import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";

function storageRoot() {
  return path.resolve(env.UPLOAD_DIR);
}

export function createStorageKey(requestId: string, extension: string) {
  return path.posix.join("requests", requestId, `${randomUUID()}.${extension}`);
}

export function createProjectStorageKey(
  projectId: string,
  extension: string,
) {
  return path.posix.join("projects", projectId, `${randomUUID()}.${extension}`);
}

export function createReplacementStorageKey(
  currentStorageKey: string,
  extension: string,
) {
  return path.posix.join(
    path.posix.dirname(currentStorageKey),
    `${randomUUID()}.${extension}`,
  );
}

export function resolveStoragePath(storageKey: string) {
  const root = storageRoot();
  const target = path.resolve(root, storageKey);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("INVALID_STORAGE_KEY");
  }
  return target;
}

export async function writePrivateFile(
  storageKey: string,
  buffer: Uint8Array,
) {
  const target = resolveStoragePath(storageKey);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, buffer, { flag: "wx", mode: 0o600 });
  await chmod(target, 0o600);
}

export function readPrivateFile(storageKey: string) {
  return readFile(resolveStoragePath(storageKey));
}

export async function removePrivateFile(storageKey: string) {
  try {
    await unlink(resolveStoragePath(storageKey));
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
}
