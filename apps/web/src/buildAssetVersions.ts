import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export function createPublicAssetVersions(root: string): Record<string, string> {
  const versions: Record<string, string> = {};

  for (const filePath of listFiles(root)) {
    const relativePath = path.relative(root, filePath).split(path.sep).join("/");
    versions[`/${relativePath}`] = createHash("sha256").update(readFileSync(filePath)).digest("hex").slice(0, 12);
  }

  return versions;
}

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
    });
}
