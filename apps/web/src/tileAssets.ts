import type { Dragon, Flower, Suit, Tile, Wind } from "@taiwan-mahjong/shared";

const tileAssetBase = "/tiles";

const suitedAssetFolders: Record<Suit, string> = {
  characters: "characters",
  dots: "dots",
  bamboo: "bamboo"
};

const windAssetPaths: Record<Wind, string> = {
  east: `${tileAssetBase}/winds/east.svg`,
  south: `${tileAssetBase}/winds/south.svg`,
  west: `${tileAssetBase}/winds/west.svg`,
  north: `${tileAssetBase}/winds/north.svg`
};

const dragonAssetPaths: Record<Dragon, string> = {
  red: `${tileAssetBase}/dragons/red.svg`,
  green: `${tileAssetBase}/dragons/green.svg`,
  white: `${tileAssetBase}/dragons/white.svg`
};

const flowerAssetPaths: Record<Flower, string> = {
  spring: `${tileAssetBase}/flowers/spring.svg`,
  summer: `${tileAssetBase}/flowers/summer.svg`,
  autumn: `${tileAssetBase}/flowers/autumn.svg`,
  winter: `${tileAssetBase}/flowers/winter.svg`,
  plum: `${tileAssetBase}/flowers/plum.svg`,
  orchid: `${tileAssetBase}/flowers/orchid.svg`,
  chrysanthemum: `${tileAssetBase}/flowers/chrysanthemum.svg`,
  bamboo: `${tileAssetBase}/flowers/bamboo.svg`
};

const suitedAssetPaths = Object.values(suitedAssetFolders).flatMap((folder) =>
  Array.from({ length: 9 }, (_, index) => `${tileAssetBase}/${folder}/${index + 1}.svg`)
);

export const tileAssetPaths = [
  ...suitedAssetPaths,
  ...Object.values(windAssetPaths),
  ...Object.values(dragonAssetPaths),
  ...Object.values(flowerAssetPaths)
];

export function tileImagePath(tile: Tile): string | undefined {
  if (tile.kind === "suited" && tile.suit && isRank(tile.rank)) {
    return `${tileAssetBase}/${suitedAssetFolders[tile.suit]}/${tile.rank}.svg`;
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
