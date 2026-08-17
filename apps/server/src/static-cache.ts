export const immutableAssetCacheControl = "public, max-age=31536000, immutable";
export const revalidatedAssetCacheControl = "no-cache";

const immutableDirectories = new Set(["assets", "backgrounds", "music", "tiles"]);

export function staticCacheControl(filePath: string): string {
  const normalizedPath = filePath.replaceAll("\\", "/");
  const segments = normalizedPath.split("/").filter(Boolean);

  if (segments.some((segment) => immutableDirectories.has(segment))) {
    return immutableAssetCacheControl;
  }

  return revalidatedAssetCacheControl;
}

export function shouldIndexHtmlPath(requestPath: string): boolean {
  return requestPath === "/" || requestPath === "/index.html";
}
