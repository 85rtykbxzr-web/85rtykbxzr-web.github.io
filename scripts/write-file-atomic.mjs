import { rename, unlink, writeFile } from "node:fs/promises";

export async function writeFileAtomic(path, data, options = "utf8") {
  const tempPath = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;

  try {
    await writeFile(tempPath, data, options);
    await rename(tempPath, path);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // The temporary file may not exist if the write failed before creation.
    }
    throw error;
  }
}
