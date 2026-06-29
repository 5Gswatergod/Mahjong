import type { GameMode, Wind } from "@taiwan-mahjong/shared";

export const modeLabels: Record<GameMode, string> = {
  taiwan: "台灣 16 張",
  riichi: "日式立直"
};

export const windLabels: Record<Wind, string> = {
  east: "東",
  south: "南",
  west: "西",
  north: "北"
};

export const windFullLabels: Record<Wind, string> = {
  east: "東風",
  south: "南風",
  west: "西風",
  north: "北風"
};
