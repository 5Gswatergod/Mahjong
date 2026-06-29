import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { DEFAULT_GAME_CONFIG, type GameConfig, type GameMode } from "@taiwan-mahjong/shared";
import { modeLabels } from "../constants";

type NumericSetting = {
  key: keyof GameConfig;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
  scale?: number;
};

const settings: NumericSetting[] = [
  { key: "initialCoins", label: "初始點數", min: 1_000, max: 100_000, step: 1_000 },
  { key: "basePoints", label: "底分", min: 0, max: 100_000, step: 10 },
  { key: "pointPerTai", label: "每台", min: 0, max: 10_000, step: 5 },
  { key: "claimWindowMs", label: "吃碰反應", min: 3, max: 30, step: 1, unit: "秒", scale: 1000 },
  { key: "autoDiscardMs", label: "自動出牌", min: 5, max: 120, step: 1, unit: "秒", scale: 1000 }
];

export function defaultRoomConfig(mode: GameMode): GameConfig {
  return {
    ...DEFAULT_GAME_CONFIG,
    initialCoins: mode === "riichi" ? 25_000 : DEFAULT_GAME_CONFIG.initialCoins
  };
}

export function RoomSettingsPanel({
  mode,
  config,
  onChange,
  onReset
}: {
  mode: GameMode;
  config: GameConfig;
  onChange: (config: GameConfig) => void;
  onReset: () => void;
}) {
  const updateSetting = (setting: NumericSetting, value: string) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return;
    }
    const boundedValue = Math.min(setting.max, Math.max(setting.min, numericValue));
    const scale = setting.scale ?? 1;
    onChange({
      ...config,
      [setting.key]: Math.round(boundedValue * scale)
    });
  };

  return (
    <section className="roomSettingsPanel" aria-label="牌局設定">
      <div className="panelTitle">
        <SlidersHorizontal size={17} />
        <h2>牌局設定</h2>
        <span>{modeLabels[mode]}</span>
      </div>
      <div className="settingsGrid">
        {settings.map((setting) => {
          const scale = setting.scale ?? 1;
          const value = Number(config[setting.key]) / scale;
          return (
            <label className="settingField" key={setting.key}>
              <span>{setting.label}</span>
              <div className="settingInput">
                <input
                  type="number"
                  min={setting.min}
                  max={setting.max}
                  step={setting.step}
                  value={value}
                  onChange={(event) => updateSetting(setting, event.target.value)}
                />
                {setting.unit && <em>{setting.unit}</em>}
              </div>
            </label>
          );
        })}
      </div>
      <button className="secondaryButton subtleButton" type="button" onClick={onReset}>
        <RotateCcw size={16} />
        還原預設
      </button>
    </section>
  );
}
