declare const __PUBLIC_ASSET_VERSIONS__: Readonly<Record<string, string>>;

export const publicAssetVersions = __PUBLIC_ASSET_VERSIONS__;

export function publicAssetUrl(path: string, versions: Readonly<Record<string, string>> = publicAssetVersions): string {
  const version = versions[path];
  if (!version) {
    return path;
  }

  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}v=${encodeURIComponent(version)}`;
}

export const gameTableBackgroundUrl = publicAssetUrl("/backgrounds/game-table-bg.png");
export const brandMarkUrl = publicAssetUrl("/brand/queju-icon.svg");

export function installPublicAssetStyles(root: HTMLElement = document.documentElement): void {
  root.style.setProperty("--game-table-background-image", `url("${gameTableBackgroundUrl}")`);
}
