export async function uploadFilesBestEffort<T>(
  items: readonly T[],
  upload: (item: T) => Promise<unknown>,
) {
  const failed: T[] = [];
  for (const item of items) {
    try {
      await upload(item);
    } catch {
      failed.push(item);
    }
  }
  return failed;
}

export function fileNames(files: readonly { name: string }[]) {
  return files.map((file) => file.name).join("、");
}
