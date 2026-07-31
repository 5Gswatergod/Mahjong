import type { Dragon, Flower, Suit, Tile, Wind } from "@taiwan-mahjong/shared";
import { publicAssetUrl } from "./publicAssets.js";

const tileAssetBase = "/tiles";

const suitedAssetFolders: Record<Suit, string> = {
  characters: "characters",
  dots: "dots",
  bamboo: "bamboo"
};

const windAssetPaths: Record<Wind, string> = {
  east: publicAssetUrl(`${tileAssetBase}/winds/east.svg`),
  south: publicAssetUrl(`${tileAssetBase}/winds/south.svg`),
  west: publicAssetUrl(`${tileAssetBase}/winds/west.svg`),
  north: publicAssetUrl(`${tileAssetBase}/winds/north.svg`)
};

const dragonAssetPaths: Record<Dragon, string> = {
  red: publicAssetUrl(`${tileAssetBase}/dragons/red.svg`),
  green: publicAssetUrl(`${tileAssetBase}/dragons/green.svg`),
  white: publicAssetUrl(`${tileAssetBase}/dragons/white.svg`)
};

const flowerAssetPaths: Record<Flower, string> = {
  spring: publicAssetUrl(`${tileAssetBase}/flowers/spring.svg`),
  summer: publicAssetUrl(`${tileAssetBase}/flowers/summer.svg`),
  autumn: publicAssetUrl(`${tileAssetBase}/flowers/autumn.svg`),
  winter: publicAssetUrl(`${tileAssetBase}/flowers/winter.svg`),
  plum: publicAssetUrl(`${tileAssetBase}/flowers/plum.svg`),
  orchid: publicAssetUrl(`${tileAssetBase}/flowers/orchid.svg`),
  chrysanthemum: publicAssetUrl(`${tileAssetBase}/flowers/chrysanthemum.svg`),
  bamboo: publicAssetUrl(`${tileAssetBase}/flowers/bamboo.svg`)
};

const suitedAssetPaths = Object.values(suitedAssetFolders).flatMap((folder) =>
  Array.from({ length: 9 }, (_, index) => publicAssetUrl(`${tileAssetBase}/${folder}/${index + 1}.svg`))
);

export const tileAssetPaths = [
  ...suitedAssetPaths,
  ...Object.values(windAssetPaths),
  ...Object.values(dragonAssetPaths),
  ...Object.values(flowerAssetPaths)
];

export function tileImagePath(tile: Tile): string | undefined {
  if (tile.kind === "suited" && tile.suit && isRank(tile.rank)) {
    return publicAssetUrl(`${tileAssetBase}/${suitedAssetFolders[tile.suit]}/${tile.rank}.svg`);
  }

  if (tile.wind) {
    return windAssetPaths[tile.wind];
  }

  if (tile.dragon) {
    return dragonAssetPaths[tile.dragon];
  }

  if (tile.flower) {
    return flowerAssetPaths[tile.flower];
  }

  return undefined;
}

function isRank(value: number | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 9;
}
