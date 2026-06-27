import {
  type Dragon,
  dragonLabels,
  type Flower,
  flowerLabels,
  type GameMode,
  type Suit,
  suitLabels,
  type Tile,
  type Wind,
  windLabels
} from "@taiwan-mahjong/shared";

export const suits: Suit[] = ["characters", "dots", "bamboo"];
export const winds: Wind[] = ["east", "south", "west", "north"];
export const dragons: Dragon[] = ["red", "green", "white"];
export const flowers: Flower[] = [
  "spring",
  "summer",
  "autumn",
  "winter",
  "plum",
  "orchid",
  "chrysanthemum",
  "bamboo"
];

const suitBase: Record<Suit, number> = {
  characters: 0,
  dots: 40,
  bamboo: 80
};

const windBase: Record<Wind, number> = {
  east: 130,
  south: 134,
  west: 138,
  north: 142
};

const dragonBase: Record<Dragon, number> = {
  red: 160,
  green: 164,
  white: 168
};

const flowerBase: Record<Flower, number> = {
  spring: 200,
  summer: 201,
  autumn: 202,
  winter: 203,
  plum: 204,
  orchid: 205,
  chrysanthemum: 206,
  bamboo: 207
};

export function buildWall(mode: GameMode = "taiwan"): Tile[] {
  return mode === "riichi" ? buildRiichiWall() : buildTaiwanWall();
}

export function buildTaiwanWall(): Tile[] {
  const tiles: Tile[] = [];

  for (const suit of suits) {
    for (let rank = 1; rank <= 9; rank += 1) {
      for (let copy = 0; copy < 4; copy += 1) {
        tiles.push({
          id: `${suit}-${rank}-${copy}`,
          kind: "suited",
          suit,
          rank,
          copy,
          label: `${rank}${suitLabels[suit]}`,
          sortKey: suitBase[suit] + rank * 4 + copy
        });
      }
    }
  }

  for (const wind of winds) {
    for (let copy = 0; copy < 4; copy += 1) {
      tiles.push({
        id: `${wind}-${copy}`,
        kind: "honor",
        wind,
        copy,
        label: windLabels[wind],
        sortKey: windBase[wind] + copy
      });
    }
  }

  for (const dragon of dragons) {
    for (let copy = 0; copy < 4; copy += 1) {
      tiles.push({
        id: `${dragon}-${copy}`,
        kind: "honor",
        dragon,
        copy,
        label: dragonLabels[dragon],
        sortKey: dragonBase[dragon] + copy
      });
    }
  }

  for (const flower of flowers) {
    tiles.push({
      id: `${flower}-0`,
      kind: "flower",
      flower,
      copy: 0,
      label: flowerLabels[flower],
      sortKey: flowerBase[flower]
    });
  }

  return tiles;
}

export function buildRiichiWall(): Tile[] {
  const tiles: Tile[] = [];

  for (const suit of suits) {
    for (let rank = 1; rank <= 9; rank += 1) {
      for (let copy = 0; copy < 4; copy += 1) {
        const red = rank === 5 && copy === 0;
        tiles.push({
          id: `${suit}-${rank}-${copy}`,
          kind: "suited",
          suit,
          rank,
          ...(red ? { red: true } : {}),
          copy,
          label: red ? `赤${rank}${suitLabels[suit]}` : `${rank}${suitLabels[suit]}`,
          sortKey: suitBase[suit] + rank * 4 + copy
        });
      }
    }
  }

  for (const wind of winds) {
    for (let copy = 0; copy < 4; copy += 1) {
      tiles.push({
        id: `${wind}-${copy}`,
        kind: "honor",
        wind,
        copy,
        label: windLabels[wind],
        sortKey: windBase[wind] + copy
      });
    }
  }

  for (const dragon of dragons) {
    for (let copy = 0; copy < 4; copy += 1) {
      tiles.push({
        id: `${dragon}-${copy}`,
        kind: "honor",
        dragon,
        copy,
        label: dragonLabels[dragon],
        sortKey: dragonBase[dragon] + copy
      });
    }
  }

  return tiles;
}

export function shuffleTiles(tiles: Tile[], random = Math.random): Tile[] {
  const shuffled = [...tiles];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const current = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = current;
  }
  return shuffled;
}

export function sortTiles(tiles: Tile[]): Tile[] {
  return [...tiles].sort((left, right) => left.sortKey - right.sortKey);
}

export function tileKey(tile: Tile): string {
  if (tile.kind === "suited") {
    return `${tile.suit}:${tile.rank}`;
  }
  if (tile.wind) {
    return `wind:${tile.wind}`;
  }
  if (tile.dragon) {
    return `dragon:${tile.dragon}`;
  }
  return `flower:${tile.flower}`;
}

export function tileTypeLabel(key: string): string {
  const [family, value] = key.split(":");
  if (family === "characters") {
    return `${value}萬`;
  }
  if (family === "dots") {
    return `${value}筒`;
  }
  if (family === "bamboo") {
    return `${value}條`;
  }
  if (family === "wind") {
    return windLabels[value as Wind];
  }
  if (family === "dragon") {
    return dragonLabels[value as Dragon];
  }
  return value ?? key;
}

export function sameTileType(left: Tile, right: Tile): boolean {
  return tileKey(left) === tileKey(right);
}

export function isSuitedKey(key: string): boolean {
  return key.startsWith("characters:") || key.startsWith("dots:") || key.startsWith("bamboo:");
}

export function keySuit(key: string): Suit | undefined {
  const [family] = key.split(":");
  return suits.includes(family as Suit) ? (family as Suit) : undefined;
}

export function keyRank(key: string): number | undefined {
  const [, rawRank] = key.split(":");
  const rank = Number(rawRank);
  return Number.isInteger(rank) ? rank : undefined;
}

export function createTileFromKey(key: string, copy = 0): Tile {
  const [family, rawValue] = key.split(":");
  if (!family || !rawValue) {
    throw new Error(`Invalid tile key: ${key}`);
  }

  if (suits.includes(family as Suit)) {
    const suit = family as Suit;
    const rank = Number(rawValue);
    return {
      id: `${suit}-${rank}-virtual-${copy}`,
      kind: "suited",
      suit,
      rank,
      copy,
      label: `${rank}${suitLabels[suit]}`,
      sortKey: suitBase[suit] + rank * 4 + copy
    };
  }

  if (family === "wind") {
    const wind = rawValue as Wind;
    return {
      id: `${wind}-virtual-${copy}`,
      kind: "honor",
      wind,
      copy,
      label: windLabels[wind],
      sortKey: windBase[wind] + copy
    };
  }

  if (family === "dragon") {
    const dragon = rawValue as Dragon;
    return {
      id: `${dragon}-virtual-${copy}`,
      kind: "honor",
      dragon,
      copy,
      label: dragonLabels[dragon],
      sortKey: dragonBase[dragon] + copy
    };
  }

  throw new Error(`Unsupported tile key: ${key}`);
}

export function allPlayableTileKeys(): string[] {
  const keys: string[] = [];
  for (const suit of suits) {
    for (let rank = 1; rank <= 9; rank += 1) {
      keys.push(`${suit}:${rank}`);
    }
  }
  for (const wind of winds) {
    keys.push(`wind:${wind}`);
  }
  for (const dragon of dragons) {
    keys.push(`dragon:${dragon}`);
  }
  return keys;
}

export function nextSeat(seatIndex: number): number {
  return (seatIndex + 1) % 4;
}

export function seatDistance(fromSeat: number, toSeat: number): number {
  return (toSeat - fromSeat + 4) % 4;
}

export function flowerMatchesWind(tile: Tile, wind: Wind): boolean {
  if (tile.kind !== "flower" || !tile.flower) {
    return false;
  }

  const mapping: Record<Wind, Flower[]> = {
    east: ["spring", "plum"],
    south: ["summer", "orchid"],
    west: ["autumn", "chrysanthemum"],
    north: ["winter", "bamboo"]
  };

  return mapping[wind].includes(tile.flower);
}

export function hasFlowerSet(tiles: Tile[], set: "season" | "plant"): boolean {
  const names = new Set(tiles.map((tile) => tile.flower).filter(Boolean));
  if (set === "season") {
    return ["spring", "summer", "autumn", "winter"].every((flower) => names.has(flower as Flower));
  }
  return ["plum", "orchid", "chrysanthemum", "bamboo"].every((flower) => names.has(flower as Flower));
}
