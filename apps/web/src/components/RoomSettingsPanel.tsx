import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { DEFAULT_GAME_CONFIG, type BotDifficulty, type GameConfig, type GameMode } from "@taiwan-mahjong/shared";
import { modeLabels } from "../constants";

type NumericSettingKey = {
  [Key in keyof GameConfig]: GameConfig[Key] extends number ? Key : never;
}[keyof GameConfig];

type NumericSetting = {
  key: NumericSettingKey;
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

const aiDifficultyOptions: Array<{ value: BotDifficulty; label: string }> = [
  { value: "novice", label: "新手" },
  { value: "beginner", label: "入門" },
  { value: "dreamer", label: "有夢想" },
  { value: "expert", label: "專家" }
];

export const aiDifficultyLabels: Record<BotDifficulty, string> = {
  novice: "新手",
  beginner: "入門",
  dreamer: "有夢想",
  expert: "專家"
};

export function defaultRoomConfig(mode: GameMode): GameConfig {
  return {
    ...DEFAULT_GAME_CONFIG,
    initialCoins: mode === "riichi" ? 25_000 : DEFAULT_GAME_CONFIG.initialCoins
  };
}

function buildSettingDrafts(config: GameConfig): Record<NumericSettingKey, string> {
  const drafts = {} as Record<NumericSettingKey, string>;
  for (const setting of settings) {
    drafts[setting.key] = formatSettingValue(setting, config);
  }
  return drafts;
}

function formatSettingValue(setting: NumericSetting, config: GameConfig): string {
  const scale = setting.scale ?? 1;
  return String(Number(config[setting.key]) / scale);
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
  const [settingDrafts, setSettingDrafts] = useState<Record<NumericSettingKey, string>>(() => buildSettingDrafts(config));

  useEffect(() => {
    setSettingDrafts(buildSettingDrafts(config));
  }, [config]);

  const updateSettingDraft = (setting: NumericSetting, value: string) => {
    setSettingDrafts((current) => ({
      ...current,
      [setting.key]: value
    }));
  };

  const commitSetting = (setting: NumericSetting, value: string) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      setSettingDrafts((current) => ({
        ...current,
        [setting.key]: formatSettingValue(setting, config)
      }));
      return;
    }
    const boundedValue = Math.min(setting.max, Math.max(setting.min, numericValue));
    const scale = setting.scale ?? 1;
    onChange({
      ...config,
      [setting.key]: Math.round(boundedValue * scale)
    });
  };

  const updateAiDifficulty = (aiDifficulty: BotDifficulty) => {
    onChange({
      ...config,
      aiDifficulty
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
          const value = settingDrafts[setting.key] ?? formatSettingValue(setting, config);
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
                  inputMode="numeric"
                  onBlur={(event) => commitSetting(setting, event.target.value)}
                  onChange={(event) => updateSettingDraft(setting, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur();
                    }
                  }}
                />
                {setting.unit && <em>{setting.unit}</em>}
              </div>
            </label>
          );
        })}
        <div className="settingField">
          <span>AI 難度</span>
          <div className="difficultyPicker" role="group" aria-label="AI 難度">
            {aiDifficultyOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={config.aiDifficulty === option.value ? "difficultyOption active" : "difficultyOption"}
                aria-pressed={config.aiDifficulty === option.value}
                onClick={() => updateAiDifficulty(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <button className="secondaryButton subtleButton" type="button" onClick={onReset}>
        <RotateCcw size={16} />
        還原預設
      </button>
    </section>
  );
}
