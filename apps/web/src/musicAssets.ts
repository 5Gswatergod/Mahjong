import { publicAssetUrl } from "./publicAssets.js";

const musicBase = "/music";

export interface MusicTrack {
  path: string;
  loop: true;
}

function loopableTrack(path: string): MusicTrack {
  return {
    path: publicAssetUrl(`${musicBase}/${path}`),
    loop: true
  };
}

export const musicTracks = {
  mainMenuOne: loopableTrack("menu/main-menu-01-loop.mp3"),
  mainMenuTwo: loopableTrack("menu/main-menu-02-loop.mp3"),
  lobbyOne: loopableTrack("lobby/lobby-01-loop.mp3"),
  lobbyTwo: loopableTrack("lobby/lobby-02-loop.mp3"),
  tableOne: loopableTrack("table/table-01-loop.mp3"),
  tableTwo: loopableTrack("table/table-02-loop.mp3"),
  tableThree: loopableTrack("table/table-03-loop.mp3"),
  tenpaiOne: loopableTrack("tenpai/tenpai-01-loop.mp3"),
  tenpaiTwo: loopableTrack("tenpai/tenpai-02-loop.mp3"),
  tenpaiThree: loopableTrack("tenpai/tenpai-03-loop.mp3"),
  drawOne: loopableTrack("result/draw-01-loop.mp3"),
  drawTwo: loopableTrack("result/draw-02-loop.mp3"),
  winOne: loopableTrack("result/win-01-loop.mp3"),
  winTwo: loopableTrack("result/win-02-loop.mp3"),
  winThree: loopableTrack("result/win-03-loop.mp3"),
  selfDrawOne: loopableTrack("result/self-draw-01-loop.mp3"),
  selfDrawTwo: loopableTrack("result/self-draw-02-loop.mp3")
} as const;

export type MusicTrackId = keyof typeof musicTracks;

export const mainMenuMusicTracks = [musicTracks.mainMenuOne, musicTracks.mainMenuTwo] as const;
export const lobbyMusicTracks = [musicTracks.lobbyOne, musicTracks.lobbyTwo] as const;
export const tableMusicTracks = [musicTracks.tableOne, musicTracks.tableTwo, musicTracks.tableThree] as const;
export const tenpaiMusicTracks = [musicTracks.tenpaiOne, musicTracks.tenpaiTwo, musicTracks.tenpaiThree] as const;
export const drawMusicTracks = [musicTracks.drawOne, musicTracks.drawTwo] as const;
export const winMusicTracks = [musicTracks.winOne, musicTracks.winTwo, musicTracks.winThree] as const;
export const selfDrawMusicTracks = [musicTracks.selfDrawOne, musicTracks.selfDrawTwo] as const;

export const musicAssetPaths = Object.values(musicTracks).map((track) => track.path);
