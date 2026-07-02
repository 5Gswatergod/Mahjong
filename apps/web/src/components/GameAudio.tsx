import { useEffect, useMemo, useRef } from "react";
import { Volume1, Volume2, VolumeX } from "lucide-react";
import type { MusicTrack } from "../musicAssets";

const musicVolumeStorageKey = "taiwanMahjong.musicVolume";

export function readStoredMusicVolume(): number {
  if (typeof window === "undefined") {
    return 0.55;
  }

  const stored = window.localStorage.getItem(musicVolumeStorageKey);
  if (stored === null) {
    return 0.55;
  }

  const parsed = Number(stored);
  return Number.isFinite(parsed) ? clampVolume(parsed) : 0.55;
}

export function AudioSettings({ volume, onVolumeChange }: { volume: number; onVolumeChange: (volume: number) => void }) {
  const percent = Math.round(volume * 100);
  const Icon = volume <= 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div className="audioSettings" aria-label="音樂音量">
      <Icon size={18} />
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={percent}
        aria-label="音樂音量"
        onChange={(event) => onVolumeChange(clampVolume(Number(event.currentTarget.value) / 100))}
      />
      <output>{percent}%</output>
    </div>
  );
}

export function MusicDirector({ track, volume }: { track: MusicTrack | null; volume: number }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const unlockedRef = useRef(false);
  const safeVolume = useMemo(() => clampVolume(volume), [volume]);

  useEffect(() => {
    window.localStorage.setItem(musicVolumeStorageKey, String(safeVolume));
  }, [safeVolume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.volume = safeVolume;
    if (safeVolume <= 0) {
      audio.pause();
      return;
    }

    if (unlockedRef.current) {
      void audio.play().catch(() => undefined);
    }
  }, [safeVolume]);

  useEffect(() => {
    audioRef.current?.pause();
    audioRef.current = null;

    if (!track) {
      return;
    }

    const audio = new Audio(track.path);
    audio.loop = track.loop;
    audio.preload = "auto";
    audio.volume = safeVolume;
    audioRef.current = audio;

    if (unlockedRef.current && safeVolume > 0) {
      void audio.play().catch(() => undefined);
    }

    return () => {
      audio.pause();
      audio.src = "";
      if (audioRef.current === audio) {
        audioRef.current = null;
      }
    };
  }, [track]);

  useEffect(() => {
    const unlockAudio = () => {
      unlockedRef.current = true;
      const audio = audioRef.current;
      if (audio && safeVolume > 0) {
        void audio.play().catch(() => undefined);
      }
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
      window.removeEventListener("touchstart", unlockAudio);
    };

    window.addEventListener("pointerdown", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });
    window.addEventListener("touchstart", unlockAudio, { once: true });

    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
      window.removeEventListener("touchstart", unlockAudio);
    };
  }, [safeVolume]);

  return null;
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.55;
  }
  return Math.min(1, Math.max(0, value));
}
