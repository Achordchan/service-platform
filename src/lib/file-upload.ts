export async function uploadFilesBestEffort(
  files: readonly File[],
  upload: (file: File) => Promise<unknown>,
) {
  const failedFiles: File[] = [];
  for (const file of files) {
    try {
      await upload(file);
    } catch {
      failedFiles.push(file);
    }
  }
  return failedFiles;
}

export function fileNames(files: readonly File[]) {
  return files.map((file) => file.name).join("、");
}
