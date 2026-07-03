import { useEffect, useMemo, useRef } from "react";
import { Volume1, Volume2, VolumeX, X } from "lucide-react";
import type { MusicTrack } from "../musicAssets";

const musicVolumeStorageKey = "taiwanMahjong.musicVolume";
const musicFadeMs = 850;

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

export function AudioSettingsButton({ volume, onClick }: { volume: number; onClick: () => void }) {
  const Icon = volume <= 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <button className="iconButton" type="button" onClick={onClick} title="音樂音量">
      <Icon size={18} />
    </button>
  );
}

export function AudioSettings({
  volume,
  onVolumeChange,
  onClose
}: {
  volume: number;
  onVolumeChange: (volume: number) => void;
  onClose: () => void;
}) {
  const percent = Math.round(volume * 100);
  const Icon = volume <= 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div className="audioBackdrop" role="dialog" aria-modal="true" aria-label="音樂音量">
      <section className="audioPanel">
        <header className="audioHeader">
          <div>
            <span className="audioKicker">
              <Icon size={16} />
              音樂
            </span>
            <h2>音量設定</h2>
          </div>
          <button className="closeSettlement" type="button" onClick={onClose} title="關閉音量設定">
            <X size={18} />
          </button>
        </header>
        <div className="audioControl" aria-label="音樂音量">
          <Icon size={22} />
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
      </section>
    </div>
  );
}

export function MusicDirector({ track, volume }: { track: MusicTrack | null; volume: number }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fadeFrameRef = useRef<number | undefined>();
  const fadeTokenRef = useRef(0);
  const fadeActiveRef = useRef(false);
  const fadingAudiosRef = useRef(new Set<HTMLAudioElement>());
  const targetVolumeRef = useRef(0.55);
  const unlockedRef = useRef(false);
  const safeVolume = useMemo(() => clampVolume(volume), [volume]);

  useEffect(() => {
    targetVolumeRef.current = safeVolume;
    window.localStorage.setItem(musicVolumeStorageKey, String(safeVolume));
  }, [safeVolume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (fadeActiveRef.current) {
      return;
    }

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
    const previousAudio = audioRef.current;
    const fadeToken = fadeTokenRef.current + 1;
    fadeTokenRef.current = fadeToken;
    stopFade();

    if (!track) {
      audioRef.current = null;
      fadeOutAndDispose(previousAudio, fadeToken);
      return;
    }

    if (previousAudio?.src.endsWith(track.path)) {
      return;
    }

    const nextAudio = new Audio(track.path);
    nextAudio.loop = track.loop;
    nextAudio.preload = "auto";
    nextAudio.volume = unlockedRef.current ? 0 : targetVolumeRef.current;
    audioRef.current = nextAudio;

    if (!unlockedRef.current) {
      disposeAudio(previousAudio);
      return;
    }

    if (targetVolumeRef.current > 0) {
      void nextAudio.play().catch(() => undefined);
    }
    crossfade(previousAudio, nextAudio, fadeToken);
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

  useEffect(() => {
    return () => {
      stopFade();
      disposeAudio(audioRef.current);
      audioRef.current = null;
    };
  }, []);

  function crossfade(previousAudio: HTMLAudioElement | null, nextAudio: HTMLAudioElement, token: number): void {
    if (!previousAudio) {
      nextAudio.volume = targetVolumeRef.current;
      return;
    }

    fadingAudiosRef.current.add(previousAudio);
    fadeActiveRef.current = true;
    const startedAt = performance.now();

    const step = (now: number) => {
      if (fadeTokenRef.current !== token) {
        return;
      }

      const progress = clampUnit((now - startedAt) / musicFadeMs);
      const targetVolume = targetVolumeRef.current;
      previousAudio.volume = clampVolume(targetVolume * (1 - progress));
      nextAudio.volume = clampVolume(targetVolume * progress);

      if (progress < 1) {
        fadeFrameRef.current = window.requestAnimationFrame(step);
        return;
      }

      fadeActiveRef.current = false;
      fadeFrameRef.current = undefined;
      fadingAudiosRef.current.delete(previousAudio);
      disposeAudio(previousAudio);
      nextAudio.volume = clampVolume(targetVolume);
      if (targetVolume <= 0) {
        nextAudio.pause();
      }
    };

    fadeFrameRef.current = window.requestAnimationFrame(step);
  }

  function fadeOutAndDispose(audio: HTMLAudioElement | null, token: number): void {
    if (!audio) {
      return;
    }

    if (!unlockedRef.current) {
      disposeAudio(audio);
      return;
    }

    fadingAudiosRef.current.add(audio);
    fadeActiveRef.current = true;
    const startedAt = performance.now();
    const startingVolume = audio.volume;

    const step = (now: number) => {
      if (fadeTokenRef.current !== token) {
        return;
      }

      const progress = clampUnit((now - startedAt) / musicFadeMs);
      audio.volume = clampVolume(startingVolume * (1 - progress));

      if (progress < 1) {
        fadeFrameRef.current = window.requestAnimationFrame(step);
        return;
      }

      fadeActiveRef.current = false;
      fadeFrameRef.current = undefined;
      fadingAudiosRef.current.delete(audio);
      disposeAudio(audio);
    };

    fadeFrameRef.current = window.requestAnimationFrame(step);
  }

  function stopFade(): void {
    if (fadeFrameRef.current !== undefined) {
      window.cancelAnimationFrame(fadeFrameRef.current);
      fadeFrameRef.current = undefined;
    }
    fadingAudiosRef.current.forEach((audio) => disposeAudio(audio));
    fadingAudiosRef.current.clear();
    fadeActiveRef.current = false;
  }

  return null;
}

function disposeAudio(audio: HTMLAudioElement | null): void {
  if (!audio) {
    return;
  }
  audio.pause();
  audio.src = "";
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.55;
  }
  return Math.min(1, Math.max(0, value));
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
